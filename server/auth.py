import hashlib
import os
import secrets
from datetime import timedelta

import bcrypt
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import text

from db import engine, utcnow

SESSION_COOKIE = "session"
SESSION_IDLE_HOURS = 8  # sliding idle timeout (AUTH-07)
MAX_FAILED = 5
LOCK_MINUTES = 15

ROLES = ("super_admin", "hr_admin", "manager", "employee")
HR_ROLES = ("super_admin", "hr_admin")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def check_password_policy(password: str) -> None:
    if len(password) < 8 or not any(c.isdigit() for c in password) or not any(c.isalpha() for c in password):
        raise HTTPException(422, "Password must be at least 8 characters and contain a letter and a number")


def create_session(response: Response, user_id: str) -> None:
    token = secrets.token_urlsafe(32)
    expires_at = utcnow() + timedelta(hours=SESSION_IDLE_HOURS)
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO sessions (id, user_id, expires_at) VALUES (:id, :user_id, :expires_at)"),
            {"id": hash_token(token), "user_id": user_id, "expires_at": expires_at},
        )
    response.set_cookie(
        SESSION_COOKIE, token, httponly=True, samesite="lax",
        secure=os.environ.get("ENV") == "production",
    )


def clear_session(request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM sessions WHERE id = :id"), {"id": hash_token(token)})
    response.delete_cookie(SESSION_COOKIE)


def revoke_user_sessions(user_id: str) -> None:
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM sessions WHERE user_id = :u"), {"u": user_id})


def _load_user(request: Request) -> dict | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    sid = hash_token(token)
    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                SELECT u.id, u.email, u.name, u.role, u.must_change_password, e.id AS employee_id
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                LEFT JOIN employees e ON e.user_id = u.id
                WHERE s.id = :id AND s.expires_at > UTC_TIMESTAMP() AND u.active = 1
                """
            ),
            {"id": sid},
        ).mappings().first()
        if row:  # slide the idle timeout
            conn.execute(text("UPDATE sessions SET expires_at = :e WHERE id = :id"),
                         {"e": utcnow() + timedelta(hours=SESSION_IDLE_HOURS), "id": sid})
    if not row:
        return None
    user = dict(row)
    user["must_change_password"] = bool(user["must_change_password"])
    return user


def get_optional_user(request: Request) -> dict | None:
    return _load_user(request)


def get_user_allow_pending(request: Request) -> dict:
    user = _load_user(request)
    if not user:
        raise HTTPException(401, "Sign in required")
    return user


def get_current_user(user: dict = Depends(get_user_allow_pending)) -> dict:
    if user["must_change_password"]:
        raise HTTPException(403, "Password change required")
    return user


def require_roles(*roles: str):
    def dep(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(403, "Access denied")
        return user
    return dep


require_hr = require_roles(*HR_ROLES)
require_super = require_roles("super_admin")


def audit(user: dict | None, action: str, entity: str | None = None, entity_id=None,
          detail: str | None = None, email: str | None = None) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO audit_log (user_id, user_email, action, entity, entity_id, detail) "
                 "VALUES (:u, :e, :a, :en, :eid, :d)"),
            {"u": user["id"] if user else None, "e": (user or {}).get("email") or email, "a": action,
             "en": entity, "eid": str(entity_id) if entity_id is not None else None,
             "d": (detail or "")[:500] or None},
        )
