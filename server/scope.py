"""Data-scope helpers: who may see / edit which employee records."""
from fastapi import HTTPException
from sqlalchemy import text

from auth import HR_ROLES
from db import engine, utcnow


def team_ids(manager_employee_id: int | None) -> list[int]:
    """All employees reporting (directly or indirectly) to the given employee."""
    if not manager_employee_id:
        return []
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                """
                WITH RECURSIVE team AS (
                  SELECT id FROM employees WHERE manager_id = :m
                  UNION
                  SELECT e.id FROM employees e JOIN team t ON e.manager_id = t.id
                )
                SELECT id FROM team
                """
            ),
            {"m": manager_employee_id},
        ).all()
    return [r[0] for r in rows]


def can_view(user: dict, employee_id: int) -> bool:
    if user["role"] in HR_ROLES:
        return True
    if user.get("employee_id") == employee_id:
        return True
    if user["role"] == "manager" and employee_id in team_ids(user.get("employee_id")):
        return True
    return False


def require_view(user: dict, employee_id: int) -> None:
    if not can_view(user, employee_id):
        raise HTTPException(403, "Access denied")


def can_see_sensitive(user: dict, employee_id: int) -> bool:
    return user["role"] in HR_ROLES or user.get("employee_id") == employee_id


def apply_due_changes() -> None:
    """Apply future-dated job changes whose effective date has arrived, and finish due offboardings."""
    import json

    today = utcnow().date()
    with engine.begin() as conn:
        due = conn.execute(
            text("SELECT * FROM pending_job_changes WHERE applied = 0 AND effective_date <= :d"), {"d": today}
        ).mappings().all()
        for p in due:
            changes = p["changes"] if isinstance(p["changes"], dict) else json.loads(p["changes"])
            cur = conn.execute(text("SELECT * FROM employees WHERE id = :id"), {"id": p["employee_id"]}).mappings().first()
            for field, new in changes.items():
                conn.execute(text(f"UPDATE employees SET {field} = :v WHERE id = :id"),  # field is whitelisted at creation
                             {"v": new, "id": p["employee_id"]})
                conn.execute(
                    text("INSERT INTO employee_history (employee_id, changed_by, change_type, field, old_value, "
                         "new_value, effective_date) VALUES (:e, :by, :t, :f, :o, :n, :d)"),
                    {"e": p["employee_id"], "by": p["created_by"], "t": p["change_type"], "f": field,
                     "o": None if cur[field] is None else str(cur[field]), "n": None if new is None else str(new),
                     "d": p["effective_date"]})
            conn.execute(text("UPDATE pending_job_changes SET applied = 1 WHERE id = :id"), {"id": p["id"]})

        finishing = conn.execute(
            text("SELECT id, user_id FROM employees WHERE status = 'offboarding' AND last_working_day <= :d"),
            {"d": today}).all()
        for emp_id, user_id in finishing:
            conn.execute(text("UPDATE employees SET status = 'terminated' WHERE id = :id"), {"id": emp_id})
            conn.execute(text("INSERT INTO employee_history (employee_id, change_type, field, old_value, new_value) "
                              "VALUES (:e, 'offboarding', 'status', 'offboarding', 'terminated')"), {"e": emp_id})
            if user_id:
                conn.execute(text("UPDATE users SET active = 0 WHERE id = :u"), {"u": user_id})
                conn.execute(text("DELETE FROM sessions WHERE user_id = :u"), {"u": user_id})
