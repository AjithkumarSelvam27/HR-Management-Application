from fastapi import APIRouter, Depends
from sqlalchemy import text

from auth import HR_ROLES, get_current_user
from db import engine, utcnow
from scope import apply_due_changes, team_ids

router = APIRouter()


def _people(conn, where: str, params: dict, limit: int = 8):
    rows = conn.execute(
        text("SELECT e.id, e.first_name, e.last_name, e.join_date, e.dob, d.name AS department FROM employees e "
             "LEFT JOIN departments d ON d.id = e.department_id WHERE e.status <> 'terminated' AND " + where +
             " LIMIT " + str(limit)), params).mappings().all()
    return [dict(r) for r in rows]


@router.get("")
def dashboard(user: dict = Depends(get_current_user)):
    apply_due_changes()
    today = utcnow().date()
    role = user["role"]
    out: dict = {"role": role}
    with engine.begin() as conn:
        out["holidays"] = [dict(r) for r in conn.execute(
            text("SELECT name, holiday_date FROM holidays WHERE holiday_date >= :t ORDER BY holiday_date LIMIT 5"),
            {"t": today}).mappings().all()]
        if user.get("employee_id"):
            me = conn.execute(
                text("SELECT e.first_name, e.last_name, e.emp_code, e.join_date, e.status, d.name AS department, "
                     "g.title AS designation, CONCAT(m.first_name, ' ', m.last_name) AS manager, "
                     "e.phone, e.address, e.emergency_contact_name, e.emergency_contact_phone, e.dob "
                     "FROM employees e LEFT JOIN departments d ON d.id = e.department_id "
                     "LEFT JOIN designations g ON g.id = e.designation_id LEFT JOIN employees m ON m.id = e.manager_id "
                     "WHERE e.id = :id"), {"id": user["employee_id"]}).mappings().first()
            if me:
                me = dict(me)
                fields = ["phone", "address", "emergency_contact_name", "emergency_contact_phone", "dob"]
                me["profile_completeness"] = round(100 * sum(1 for f in fields if me.get(f)) / len(fields))
                out["me"] = me

        if role in ("manager",) or role in HR_ROLES:
            if role == "manager":
                ids = team_ids(user.get("employee_id"))
                scope = "e.id IN (" + (",".join(str(int(i)) for i in ids) or "0") + ")"
                out["team"] = {"headcount": len(ids)}
            else:
                scope = "1=1"
            soon = "DATE_FORMAT(e.dob, '%m-%d') BETWEEN DATE_FORMAT(CURDATE(), '%m-%d') AND DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 30 DAY), '%m-%d')"
            anniv = "DATE_FORMAT(e.join_date, '%m-%d') BETWEEN DATE_FORMAT(CURDATE(), '%m-%d') AND DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 30 DAY), '%m-%d') AND e.join_date < CURDATE()"
            out["birthdays"] = _people(conn, scope + " AND e.dob IS NOT NULL AND " + soon, {})
            out["anniversaries"] = _people(conn, scope + " AND " + anniv, {})
            out["new_joiners"] = _people(conn, scope + " AND e.join_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)", {})
            if role == "manager":
                out["team"]["members"] = _people(conn, scope, {}, limit=50)

        if role in HR_ROLES:
            c = lambda sql, **p: conn.execute(text(sql), p).scalar() or 0  # noqa: E731
            out["kpis"] = {
                "total": c("SELECT COUNT(*) FROM employees WHERE status <> 'terminated'"),
                "active": c("SELECT COUNT(*) FROM employees WHERE status = 'active'"),
                "probation": c("SELECT COUNT(*) FROM employees WHERE status = 'probation'"),
                "onboarding": c("SELECT COUNT(*) FROM employees WHERE status = 'onboarding'"),
                "offboarding": c("SELECT COUNT(*) FROM employees WHERE status = 'offboarding'"),
                "new_hires_month": c("SELECT COUNT(*) FROM employees WHERE DATE_FORMAT(join_date,'%Y-%m') = DATE_FORMAT(CURDATE(),'%Y-%m')"),
                "exits_month": c("SELECT COUNT(*) FROM employees WHERE status = 'terminated' AND DATE_FORMAT(last_working_day,'%Y-%m') = DATE_FORMAT(CURDATE(),'%Y-%m')"),
            }
            out["by_department"] = [dict(r) for r in conn.execute(text(
                "SELECT COALESCE(d.name, 'Unassigned') AS label, d.id AS id, COUNT(*) AS value FROM employees e "
                "LEFT JOIN departments d ON d.id = e.department_id WHERE e.status <> 'terminated' "
                "GROUP BY d.id, d.name ORDER BY value DESC")).mappings().all()]
            out["by_location"] = [dict(r) for r in conn.execute(text(
                "SELECT COALESCE(l.name, 'Unassigned') AS label, l.id AS id, COUNT(*) AS value FROM employees e "
                "LEFT JOIN locations l ON l.id = e.location_id WHERE e.status <> 'terminated' "
                "GROUP BY l.id, l.name ORDER BY value DESC")).mappings().all()]
            hires = {r[0]: r[1] for r in conn.execute(text(
                "SELECT DATE_FORMAT(join_date,'%Y-%m'), COUNT(*) FROM employees "
                "WHERE join_date >= DATE_SUB(DATE_FORMAT(CURDATE(),'%Y-%m-01'), INTERVAL 11 MONTH) GROUP BY 1"))}
            exits = {r[0]: r[1] for r in conn.execute(text(
                "SELECT DATE_FORMAT(last_working_day,'%Y-%m'), COUNT(*) FROM employees WHERE status = 'terminated' "
                "AND last_working_day >= DATE_SUB(DATE_FORMAT(CURDATE(),'%Y-%m-01'), INTERVAL 11 MONTH) GROUP BY 1"))}
            months = []
            y, m = today.year, today.month
            for _ in range(12):
                months.append(f"{y:04d}-{m:02d}")
                m -= 1
                if m == 0:
                    y, m = y - 1, 12
            out["hires_vs_exits"] = [{"month": k, "hires": hires.get(k, 0), "exits": exits.get(k, 0)} for k in reversed(months)]
            out["pending_actions"] = {
                "incomplete_profiles": [dict(r) for r in conn.execute(text(
                    "SELECT id, first_name, last_name FROM employees WHERE status <> 'terminated' AND "
                    "(phone IS NULL OR phone = '' OR emergency_contact_phone IS NULL OR emergency_contact_phone = '') LIMIT 10")).mappings().all()],
                "probation_ending": [dict(r) for r in conn.execute(text(
                    "SELECT id, first_name, last_name, probation_end_date FROM employees WHERE status = 'probation' "
                    "AND probation_end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) LIMIT 10")).mappings().all()],
                "expiring_documents": [dict(r) for r in conn.execute(text(
                    "SELECT d.id, d.employee_id, d.filename, d.expiry_date FROM documents d WHERE d.expiry_date IS NOT NULL "
                    "AND d.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) ORDER BY d.expiry_date LIMIT 10")).mappings().all()],
                "missing_documents": c("SELECT COUNT(*) FROM employees e WHERE e.status <> 'terminated' AND NOT EXISTS "
                                       "(SELECT 1 FROM documents d WHERE d.employee_id = e.id)"),
            }
        if role == "super_admin":
            out["users_by_role"] = [dict(r) for r in conn.execute(text(
                "SELECT role AS label, COUNT(*) AS value FROM users WHERE active = 1 GROUP BY role")).mappings().all()]
            out["recent_audit"] = [dict(r) for r in conn.execute(text(
                "SELECT user_email, action, entity, created_at FROM audit_log ORDER BY id DESC LIMIT 8")).mappings().all()]
            n = lambda sql: conn.execute(text(sql)).scalar() or 0  # noqa: E731
            out["setup"] = [
                {"label": "Add locations", "done": n("SELECT COUNT(*) FROM locations") > 0, "link": "/org/locations"},
                {"label": "Add departments", "done": n("SELECT COUNT(*) FROM departments") > 0, "link": "/org/departments"},
                {"label": "Add designations", "done": n("SELECT COUNT(*) FROM designations") > 0, "link": "/org/designations"},
                {"label": "Create an HR Admin", "done": n("SELECT COUNT(*) FROM users WHERE role = 'hr_admin'") > 0, "link": "/employees/new"},
                {"label": "Add your first employee", "done": n("SELECT COUNT(*) FROM employees") > 0, "link": "/employees/new"},
            ]
    return out
