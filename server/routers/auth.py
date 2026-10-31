import secrets
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from auth import (
    LOCK_MINUTES,
    MAX_FAILED,
    audit,
    check_password_policy,
    clear_session,
    create_session,
    get_optional_user,
    get_user_allow_pending,
    hash_password,
    hash_token,
    revoke_user_sessions,
    verify_password,
)
from db import engine, utcnow
from mailer import app_url, send_email

router = APIRouter()


class SignInBody(BaseModel):
    email: EmailStr
    password: str


class RegisterBody(BaseModel):
    name: str
    email: EmailStr
    password: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


class ForgotBody(BaseModel):
    email: EmailStr


class ResetBody(BaseModel):
    token: str
    new_password: str


def public_user(u: dict) -> dict:
    return {"id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"],
            "employee_id": u.get("employee_id"), "must_change_password": bool(u["must_change_password"])}


@router.post("/signin")
def signin(body: SignInBody, response: Response):
    email = body.email.lower()
    with engine.begin() as conn:
        row = conn.execute(text("SELECT * FROM users WHERE email = :e"), {"e": email}).mappings().first()
        if row:
            row = dict(row)
            if row["locked_until"] and row["locked_until"] > utcnow():
                audit(None, "login_blocked_locked", "user", row["id"], email=email)
                raise HTTPException(423, "Account locked due to failed attempts. Try again in 15 minutes.")
    ok = bool(row) and verify_password(body.password, row["password_hash"])
    if not ok:
        if row:
            with engine.begin() as conn:
                failed = row["failed_attempts"] + 1
                locked = utcnow() + timedelta(minutes=LOCK_MINUTES) if failed >= MAX_FAILED else None
                conn.execute(text("UPDATE users SET failed_attempts = :f, locked_until = :l WHERE id = :id"),
                             {"f": 0 if locked else failed, "l": locked, "id": row["id"]})
        audit(None, "login_failed", "user", row["id"] if row else None, email=email)
        raise HTTPException(401, "Invalid email or password")
    if not row["active"]:
        raise HTTPException(403, "Account is deactivated. Contact HR.")
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = :id"), {"id": row["id"]})
        emp = conn.execute(text("SELECT id FROM employees WHERE user_id = :u"), {"u": row["id"]}).first()
    create_session(response, row["id"])
    audit({"id": row["id"], "email": email}, "login", "user", row["id"])
    row["employee_id"] = emp[0] if emp else None
    return public_user(row)


@router.post("/register")
def register(body: RegisterBody, response: Response):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Name is required")
    check_password_policy(body.password)
    email = body.email.lower()
    user_id = str(uuid.uuid4())
    try:
        with engine.begin() as conn:
            # Self-registration always yields the least-privileged role and is not linked to an employee
            # record (the email is unverified); HR links/elevates accounts from the Users screen.
            conn.execute(text("INSERT INTO users (id, email, password_hash, name, role, must_change_password) "
                              "VALUES (:id, :e, :ph, :n, 'employee', 0)"),
                         {"id": user_id, "e": email, "ph": hash_password(body.password), "n": name})
    except IntegrityError:
        raise HTTPException(409, "An account with this email already exists")
    create_session(response, user_id)
    audit({"id": user_id, "email": email}, "register", "user", user_id)
    return public_user({"id": user_id, "email": email, "name": name, "role": "employee",
                        "must_change_password": 0})


@router.post("/signout")
def signout(request: Request, response: Response):
    clear_session(request, response)
    return {"ok": True}


@router.get("/session")
def session(user: dict | None = Depends(get_optional_user)):
    return public_user(user) if user else None


@router.post("/change-password")
def change_password(body: ChangePasswordBody, request: Request, response: Response,
                    user: dict = Depends(get_user_allow_pending)):
    check_password_policy(body.new_password)
    with engine.begin() as conn:
        row = conn.execute(text("SELECT password_hash FROM users WHERE id = :id"), {"id": user["id"]}).first()
    if not row or not verify_password(body.current_password, row[0]):
        raise HTTPException(401, "Current password is incorrect")
    if body.current_password == body.new_password:
        raise HTTPException(422, "New password must differ from the current one")
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET password_hash = :p, must_change_password = 0 WHERE id = :id"),
                     {"p": hash_password(body.new_password), "id": user["id"]})
    revoke_user_sessions(user["id"])
    create_session(response, user["id"])
    audit(user, "password_changed", "user", user["id"])
    return {"ok": True}


@router.post("/forgot-password")
def forgot_password(body: ForgotBody):
    email = body.email.lower()
    with engine.begin() as conn:
        row = conn.execute(text("SELECT id FROM users WHERE email = :e AND active = 1"), {"e": email}).first()
        if row:
            token = secrets.token_urlsafe(32)
            conn.execute(text("INSERT INTO password_resets (id, user_id, expires_at) VALUES (:id, :u, :e)"),
                         {"id": hash_token(token), "u": row[0], "e": utcnow() + timedelta(hours=1)})
            send_email(email, "Reset your HRMS password",
                       f"Use this link within 1 hour: {app_url()}/reset-password?token={token}")
    # Always the same answer so account existence is not revealed.
    return {"message": "If the account exists, an email was sent."}


@router.post("/reset-password")
def reset_password(body: ResetBody):
    check_password_policy(body.new_password)
    with engine.begin() as conn:
        row = conn.execute(
            text("SELECT user_id FROM password_resets WHERE id = :id AND used = 0 AND expires_at > UTC_TIMESTAMP()"),
            {"id": hash_token(body.token)}).first()
        if not row:
            raise HTTPException(400, "This reset link is invalid or has expired")
        conn.execute(text("UPDATE users SET password_hash = :p, must_change_password = 0, failed_attempts = 0, "
                          "locked_until = NULL WHERE id = :id"),
                     {"p": hash_password(body.new_password), "id": row[0]})
        conn.execute(text("UPDATE password_resets SET used = 1 WHERE id = :id"), {"id": hash_token(body.token)})
    revoke_user_sessions(row[0])
    audit(None, "password_reset", "user", row[0])
    return {"ok": True}
