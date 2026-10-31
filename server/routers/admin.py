import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from auth import ROLES, audit, hash_password, require_hr, revoke_user_sessions
from db import engine
from mailer import app_url, send_email

router = APIRouter()


class UserPatch(BaseModel):
    role: str | None = None
    active: bool | None = None


def _get_user(conn, user_id: str) -> dict:
    row = conn.execute(text("SELECT id, email, name, role, active FROM users WHERE id = :id"), {"id": user_id}).mappings().first()
    if not row:
        raise HTTPException(404, "User not found")
    return dict(row)


@router.get("/users")
def list_users(q: str | None = None, user: dict = Depends(require_hr)):
    sql = ("SELECT u.id, u.email, u.name, u.role, u.active, u.must_change_password, u.locked_until, e.id AS employee_id "
           "FROM users u LEFT JOIN employees e ON e.user_id = u.id")
    params = {}
    if q:
        sql += " WHERE u.email LIKE :q OR u.name LIKE :q"
        params["q"] = f"%{q}%"
    with engine.begin() as conn:
        rows = conn.execute(text(sql + " ORDER BY u.name"), params).mappings().all()
    return [dict(r) for r in rows]


def _check_manage(actor: dict, target: dict, new_role: str | None) -> None:
    # HR Admins may only manage non-admin roles; Super Admins manage everyone (ADM-01).
    if actor["role"] == "hr_admin":
        if target["role"] in ("super_admin", "hr_admin") or new_role in ("super_admin", "hr_admin"):
            raise HTTPException(403, "Only a Super Admin can manage admin accounts")


def _other_super_admins(conn, user_id: str) -> int:
    return conn.execute(text("SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND active = 1 AND id <> :id"),
                        {"id": user_id}).scalar()


@router.patch("/users/{user_id}")
def patch_user(user_id: str, body: UserPatch, actor: dict = Depends(require_hr)):
    if body.role is not None and body.role not in ROLES:
        raise HTTPException(422, "Invalid role")
    with engine.begin() as conn:
        target = _get_user(conn, user_id)
        _check_manage(actor, target, body.role)
        demoting = target["role"] == "super_admin" and body.role not in (None, "super_admin")
        deactivating = target["role"] == "super_admin" and body.active is False
        if (demoting or deactivating) and _other_super_admins(conn, user_id) == 0:
            raise HTTPException(409, "The last Super Admin cannot be demoted or deactivated")
        if body.role is not None:
            conn.execute(text("UPDATE users SET role = :r WHERE id = :id"), {"r": body.role, "id": user_id})
        if body.active is not None:
            conn.execute(text("UPDATE users SET active = :a WHERE id = :id"), {"a": int(body.active), "id": user_id})
    if body.active is False or (body.role is not None and body.role != target["role"]):
        revoke_user_sessions(user_id)
    audit(actor, "user_updated", "user", user_id, f"role={body.role} active={body.active}")
    return {"ok": True}


@router.post("/users/{user_id}/unlock")
def unlock_user(user_id: str, actor: dict = Depends(require_hr)):
    with engine.begin() as conn:
        target = _get_user(conn, user_id)
        _check_manage(actor, target, None)
        conn.execute(text("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = :id"), {"id": user_id})
    audit(actor, "user_unlocked", "user", user_id)
    return {"ok": True}


@router.post("/users/{user_id}/resend-invite")
def resend_invite(user_id: str, actor: dict = Depends(require_hr)):
    with engine.begin() as conn:
        target = _get_user(conn, user_id)
        _check_manage(actor, target, None)
        if not target["active"]:
            raise HTTPException(409, "User is deactivated")
        temp = f"{secrets.token_urlsafe(8)}-{secrets.randbelow(90) + 10}"
        conn.execute(text("UPDATE users SET password_hash = :p, must_change_password = 1 WHERE id = :id"),
                     {"p": hash_password(temp), "id": user_id})
    revoke_user_sessions(user_id)
    send_email(target["email"], "Your HRMS invitation",
               f"Sign in at {app_url()}/login with temporary password: {temp}\nYou must change it on first login.")
    audit(actor, "invite_resent", "user", user_id)
    return {"ok": True}


@router.get("/audit-log")
def audit_log(user_email: str | None = None, action: str | None = None, entity: str | None = None,
              date_from: str | None = None, date_to: str | None = None,
              page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
              actor: dict = Depends(require_hr)):
    where, params = [], {}
    if user_email:
        where.append("user_email LIKE :ue")
        params["ue"] = f"%{user_email}%"
    if action:
        where.append("action = :a")
        params["a"] = action
    if entity:
        where.append("entity = :en")
        params["en"] = entity
    if date_from:
        where.append("created_at >= :df")
        params["df"] = date_from
    if date_to:
        where.append("created_at < DATE_ADD(:dt, INTERVAL 1 DAY)")
        params["dt"] = date_to
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    with engine.begin() as conn:
        total = conn.execute(text("SELECT COUNT(*) FROM audit_log" + clause), params).scalar()
        rows = conn.execute(text("SELECT * FROM audit_log" + clause + " ORDER BY id DESC LIMIT :l OFFSET :o"),
                            {**params, "l": page_size, "o": (page - 1) * page_size}).mappings().all()
        actions = [r[0] for r in conn.execute(text("SELECT DISTINCT action FROM audit_log ORDER BY action"))]
    return {"items": [dict(r) for r in rows], "total": total, "actions": actions}

