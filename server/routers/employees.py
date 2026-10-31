import csv
import io
import json
import os
import secrets
import uuid
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from auth import HR_ROLES, audit, get_current_user, hash_password, require_hr
from db import engine, utcnow
from mailer import app_url, send_email
from scope import apply_due_changes, can_see_sensitive, require_view, team_ids

router = APIRouter()

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_UPLOADS = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
DOC_CATEGORIES = {"contract", "id", "certificate", "other"}

EMPLOYMENT_TYPES = {"full_time", "part_time", "contract", "intern"}
STATUSES = {"onboarding", "active", "probation", "offboarding", "terminated"}
SENSITIVE_FIELDS = {"national_id", "salary"}
# Fields an employee may edit on their own record (EMP-07).
SELF_FIELDS = {"phone", "address", "emergency_contact_name", "emergency_contact_phone"}
PERSONAL_FIELDS = SELF_FIELDS | {"first_name", "last_name", "email", "dob", "gender", "national_id"}
JOB_FIELDS = {"department_id", "designation_id", "location_id", "manager_id", "employment_type", "salary",
              "join_date", "probation_end_date", "status"}
HR_EDITABLE = PERSONAL_FIELDS | JOB_FIELDS
JOB_CHANGE_FIELDS = {"department_id", "designation_id", "location_id", "manager_id", "employment_type", "salary"}
DEFAULT_CHECKLIST = [
    {"key": "assets", "label": "Return company assets", "done": False},
    {"key": "access", "label": "Revoke system access", "done": False},
    {"key": "exit_interview", "label": "Exit interview", "done": False},
    {"key": "final_docs", "label": "Issue final documents", "done": False},
]

BASE_SELECT = """
SELECT e.*, d.name AS department, g.title AS designation, l.name AS location,
       CONCAT(m.first_name, ' ', m.last_name) AS manager_name, u.role AS role, u.active AS user_active
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
LEFT JOIN designations g ON g.id = e.designation_id
LEFT JOIN locations l ON l.id = e.location_id
LEFT JOIN employees m ON m.id = e.manager_id
LEFT JOIN users u ON u.id = e.user_id
"""


class EmployeeCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    phone: str | None = None
    dob: date | None = None
    gender: str | None = None
    address: str | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    national_id: str | None = None
    salary: float | None = Field(default=None, ge=0)
    department_id: int | None = None
    designation_id: int | None = None
    location_id: int | None = None
    manager_id: int | None = None
    employment_type: str = "full_time"
    join_date: date
    probation_end_date: date | None = None
    role: str = "employee"


class JobChange(BaseModel):
    change_type: str = "other"  # promotion | transfer | manager_change | salary_change | other
    effective_date: date
    confirm_backdated: bool = False
    department_id: int | None = None
    designation_id: int | None = None
    location_id: int | None = None
    manager_id: int | None = None
    employment_type: str | None = None
    salary: float | None = Field(default=None, ge=0)


class OffboardStart(BaseModel):
    last_working_day: date
    reason: str = Field(min_length=1, max_length=255)
    exit_type: str = "resignation"


class ChecklistToggle(BaseModel):
    key: str
    done: bool


# ---------- helpers ---------------------------------------------------------

def _shape(row: dict, user: dict) -> dict:
    e = dict(row)
    e.pop("user_active", None)
    if isinstance(e.get("exit_checklist"), str):
        e["exit_checklist"] = json.loads(e["exit_checklist"])
    if not can_see_sensitive(user, e["id"]):
        for f in SENSITIVE_FIELDS:
            e.pop(f, None)
    return e


def _get_row(emp_id: int) -> dict:
    with engine.begin() as conn:
        row = conn.execute(text(BASE_SELECT + " WHERE e.id = :id"), {"id": emp_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Employee not found")
    return dict(row)


def _check_refs(data: dict) -> None:
    checks = {"department_id": "departments", "designation_id": "designations", "location_id": "locations",
              "manager_id": "employees"}
    with engine.begin() as conn:
        for f, table in checks.items():
            if data.get(f) is not None and not conn.execute(text(f"SELECT 1 FROM {table} WHERE id = :i"),
                                                           {"i": data[f]}).first():
                raise HTTPException(422, f"Invalid {f}")
    if data.get("employment_type") is not None and data["employment_type"] not in EMPLOYMENT_TYPES:
        raise HTTPException(422, "Invalid employment type")
    if data.get("status") is not None and data["status"] not in STATUSES:
        raise HTTPException(422, "Invalid status")


def _check_no_loop(emp_id: int | None, manager_id: int | None) -> None:
    """Reject reporting loops (ORG-09)."""
    if manager_id is None or emp_id is None:
        return
    with engine.begin() as conn:
        cur, seen = manager_id, set()
        while cur is not None and cur not in seen:
            if cur == emp_id:
                raise HTTPException(422, "That manager would create a reporting loop")
            seen.add(cur)
            row = conn.execute(text("SELECT manager_id FROM employees WHERE id = :i"), {"i": cur}).first()
            cur = row[0] if row else None


def _start_status(join_date: date, probation_end: date | None) -> str:
    today = utcnow().date()
    if join_date > today:
        return "onboarding"
    if probation_end and probation_end > today:
        return "probation"
    return "active"


def _create_employee(data: dict, creator: dict) -> dict:
    role = data.get("role", "employee")
    allowed_roles = ("employee", "manager") if creator["role"] == "hr_admin" else ("employee", "manager", "hr_admin", "super_admin")
    if role not in allowed_roles:
        raise HTTPException(403, "You cannot assign that role")
    _check_refs(data)
    email = data["email"].lower()
    temp_password = f"{secrets.token_urlsafe(8)}-{secrets.randbelow(90) + 10}"
    user_id = str(uuid.uuid4())
    status = _start_status(data["join_date"], data.get("probation_end_date"))
    cols = ["first_name", "last_name", "phone", "dob", "gender", "address", "emergency_contact_name",
            "emergency_contact_phone", "national_id", "salary", "department_id", "designation_id", "location_id",
            "manager_id", "employment_type", "join_date", "probation_end_date"]
    values = {c: data.get(c) for c in cols}
    values.update({"email": email, "status": status, "user_id": user_id, "code": f"TMP-{uuid.uuid4().hex[:12]}"})
    try:
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO users (id, email, password_hash, name, role, must_change_password) "
                     "VALUES (:id, :email, :ph, :name, :role, 1)"),
                {"id": user_id, "email": email, "ph": hash_password(temp_password),
                 "name": f"{data['first_name']} {data['last_name']}", "role": role})
            res = conn.execute(
                text(f"INSERT INTO employees (emp_code, email, status, user_id, {', '.join(cols)}) "
                     f"VALUES (:code, :email, :status, :user_id, {', '.join(':' + c for c in cols)})"), values)
            emp_id = res.lastrowid
            conn.execute(text("UPDATE employees SET emp_code = :c WHERE id = :id"),
                         {"c": f"EMP{emp_id:04d}", "id": emp_id})
            conn.execute(text("INSERT INTO employee_history (employee_id, changed_by, change_type, field, new_value) "
                              "VALUES (:e, :by, 'created', 'status', :s)"),
                         {"e": emp_id, "by": creator["id"], "s": status})
    except IntegrityError as e:
        code = e.orig.args[0] if e.orig and e.orig.args else None
        if code == 1062:
            raise HTTPException(409, f"An employee or user with email {email} already exists")
        raise
    send_email(email, "Welcome to the HRMS",
               f"Hi {data['first_name']}, your account is ready.\nSign in at {app_url()}/login\n"
               f"Email: {email}\nTemporary password: {temp_password}\nYou must change it on first login.")
    audit(creator, "employee_created", "employee", emp_id, email)
    result = {"id": emp_id, "emp_code": f"EMP{emp_id:04d}", "email": email, "status": status}
    if os.environ.get("ENV") != "production":
        result["temp_password"] = temp_password  # dev convenience: no SMTP is configured
    return result


def _same(old, new) -> bool:
    if old is None or new is None:
        return old is None and new is None
    try:
        return float(old) == float(new)
    except (TypeError, ValueError):
        return str(old) == str(new)


def _record_changes(emp_id: int, current: dict, changes: dict, by: str | None, change_type: str,
                    effective: date | None = None) -> None:
    with engine.begin() as conn:
        for field, new in changes.items():
            old = current.get(field)
            if _same(old, new):
                continue
            conn.execute(text(f"UPDATE employees SET {field} = :v WHERE id = :id"),  # field is whitelisted
                         {"v": new, "id": emp_id})
            conn.execute(
                text("INSERT INTO employee_history (employee_id, changed_by, change_type, field, old_value, "
                     "new_value, effective_date) VALUES (:e, :by, :t, :f, :o, :n, :d)"),
                {"e": emp_id, "by": by, "t": change_type, "f": field, "o": None if old is None else str(old),
                 "n": None if new is None else str(new), "d": effective})
        if "email" in changes or "first_name" in changes or "last_name" in changes:
            merged = {**current, **changes}
            conn.execute(text("UPDATE users SET email = :e, name = :n WHERE id = :u"),
                         {"e": merged["email"], "n": f"{merged['first_name']} {merged['last_name']}",
                          "u": current["user_id"]})


def _ensure_editable(row: dict) -> None:
    if row["status"] == "terminated":
        raise HTTPException(409, "Terminated employee records are read-only")


# ---------- list / options / export / import --------------------------------

@router.get("")
def list_employees(
    q: str | None = None, department_id: int | None = None, location_id: int | None = None,
    status: str | None = None, employment_type: str | None = None, manager_id: int | None = None,
    sort: str = "name", page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    apply_due_changes()
    where, params = [], {}
    if user["role"] not in HR_ROLES:
        ids = ([user["employee_id"]] if user.get("employee_id") else []) + (
            team_ids(user.get("employee_id")) if user["role"] == "manager" else [])
        if not ids:
            return {"items": [], "total": 0, "page": page, "page_size": page_size}
        where.append("e.id IN (" + ",".join(str(int(i)) for i in ids) + ")")
    if q:
        where.append("(e.first_name LIKE :q OR e.last_name LIKE :q OR e.email LIKE :q OR e.emp_code LIKE :q "
                     "OR CONCAT(e.first_name, ' ', e.last_name) LIKE :q)")
        params["q"] = f"%{q}%"
    for name, val in (("department_id", department_id), ("location_id", location_id), ("status", status),
                      ("employment_type", employment_type), ("manager_id", manager_id)):
        if val is not None and val != "":
            where.append(f"e.{name} = :{name}")
            params[name] = val
    order = {"name": "e.first_name, e.last_name", "join_date": "e.join_date DESC", "code": "e.emp_code"}.get(sort, "e.first_name")
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    with engine.begin() as conn:
        total = conn.execute(text("SELECT COUNT(*) FROM employees e" + clause), params).scalar()
        rows = conn.execute(
            text(BASE_SELECT + clause + f" ORDER BY {order} LIMIT :lim OFFSET :off"),
            {**params, "lim": page_size, "off": (page - 1) * page_size}).mappings().all()
    return {"items": [_shape(dict(r), user) for r in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/options")
def employee_options(user: dict = Depends(require_hr)):
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT id, emp_code, first_name, last_name FROM employees "
                                 "WHERE status <> 'terminated' ORDER BY first_name, last_name")).mappings().all()
    return [{"id": r["id"], "emp_code": r["emp_code"], "name": f"{r['first_name']} {r['last_name']}"} for r in rows]


def _csv_safe(v) -> str:
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s  # neutralize spreadsheet formula injection


@router.get("/export")
def export_employees(user: dict = Depends(require_hr)):
    with engine.begin() as conn:
        rows = conn.execute(text(BASE_SELECT + " ORDER BY e.emp_code")).mappings().all()
    cols = ["emp_code", "first_name", "last_name", "email", "phone", "department", "designation", "location",
            "manager_name", "employment_type", "status", "join_date", "last_working_day"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    for r in rows:
        w.writerow([_csv_safe(r[c]) for c in cols])
    audit(user, "employees_exported", "employee", None, f"{len(rows)} rows")
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="employees.csv"'})


@router.post("/import")
async def import_employees(file: UploadFile = File(...), confirm: bool = Form(False), user: dict = Depends(require_hr)):
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large")
    try:
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    except UnicodeDecodeError:
        raise HTTPException(422, "File must be UTF-8 CSV")
    required = {"first_name", "last_name", "email", "join_date"}
    if not reader.fieldnames or not required <= {f.strip() for f in reader.fieldnames}:
        raise HTTPException(422, "CSV must have columns: first_name, last_name, email, join_date")
    with engine.begin() as conn:
        lookups = {
            "department": {r[1].lower(): r[0] for r in conn.execute(text("SELECT id, name FROM departments"))},
            "designation": {r[1].lower(): r[0] for r in conn.execute(text("SELECT id, title FROM designations"))},
            "location": {r[1].lower(): r[0] for r in conn.execute(text("SELECT id, name FROM locations"))},
            "manager": {r[1].lower(): r[0] for r in conn.execute(text("SELECT id, email FROM employees"))},
        }
    parsed, seen_emails = [], set()
    for i, rec in enumerate(reader, start=2):
        rec = {(k or "").strip(): (v or "").strip() for k, v in rec.items()}
        errors, data = [], {}
        for f in ("first_name", "last_name", "email"):
            if not rec.get(f):
                errors.append(f"{f} is required")
        data.update({f: rec.get(f) for f in ("first_name", "last_name", "phone")})
        data["email"] = rec.get("email", "").lower()
        if data["email"] and ("@" not in data["email"] or data["email"] in seen_emails):
            errors.append("email is invalid or duplicated in file")
        seen_emails.add(data["email"])
        try:
            data["join_date"] = date.fromisoformat(rec.get("join_date", ""))
        except ValueError:
            errors.append("join_date must be YYYY-MM-DD")
        et = rec.get("employment_type") or "full_time"
        if et not in EMPLOYMENT_TYPES:
            errors.append("invalid employment_type")
        data["employment_type"] = et
        for key, field in (("department", "department_id"), ("designation", "designation_id"),
                           ("location", "location_id"), ("manager_email", "manager_id")):
            if rec.get(key):
                found = lookups["manager" if key == "manager_email" else key].get(rec[key].lower())
                if found is None:
                    errors.append(f"unknown {key}: {rec[key]}")
                data[field] = found
        parsed.append({"row": i, "errors": errors, "data": data})
    if len(parsed) > 500:
        raise HTTPException(422, "Maximum 500 rows per import")
    with engine.begin() as conn:
        for p in parsed:
            if conn.execute(text("SELECT 1 FROM employees WHERE email = :e"), {"e": p["data"]["email"]}).first():
                p["errors"].append("an employee with this email already exists")
    valid = sum(1 for p in parsed if not p["errors"])
    if not confirm:
        return {"preview": [{"row": p["row"], "email": p["data"]["email"], "errors": p["errors"]} for p in parsed],
                "valid": valid, "invalid": len(parsed) - valid}
    if valid != len(parsed):
        raise HTTPException(422, "Fix the errors in the file before confirming the import")
    for p in parsed:
        _create_employee(p["data"], user)
    audit(user, "employees_imported", "employee", None, f"{len(parsed)} rows")
    return {"imported": len(parsed)}


# ---------- create / read / update ------------------------------------------

@router.post("")
def create_employee(body: EmployeeCreate, user: dict = Depends(require_hr)):
    data = body.model_dump()
    _check_no_loop(None, data.get("manager_id"))
    return _create_employee(data, user)


@router.get("/{emp_id}")
def get_employee(emp_id: int, user: dict = Depends(get_current_user)):
    apply_due_changes()
    require_view(user, emp_id)
    return _shape(_get_row(emp_id), user)


@router.patch("/{emp_id}")
def update_employee(emp_id: int, body: dict, user: dict = Depends(get_current_user)):
    require_view(user, emp_id)
    is_hr = user["role"] in HR_ROLES
    if not is_hr and user.get("employee_id") != emp_id:
        raise HTTPException(403, "Access denied")
    allowed = HR_EDITABLE if is_hr else SELF_FIELDS
    bad = set(body) - allowed
    if bad:
        raise HTTPException(403, f"You cannot edit: {', '.join(sorted(bad))}")
    current = _get_row(emp_id)
    _ensure_editable(current)
    changes = dict(body)
    for f in ("dob", "join_date", "probation_end_date"):
        if changes.get(f):
            try:
                changes[f] = date.fromisoformat(changes[f])
            except (TypeError, ValueError):
                raise HTTPException(422, f"{f} must be YYYY-MM-DD")
    for f in ("first_name", "last_name"):
        if f in changes and not str(changes[f]).strip():
            raise HTTPException(422, f"{f} cannot be empty")
    if "email" in changes:
        changes["email"] = str(changes["email"]).lower()
        if "@" not in changes["email"]:
            raise HTTPException(422, "Invalid email")
    _check_refs(changes)
    if changes.get("status") in ("offboarding", "terminated"):
        raise HTTPException(422, "Use the offboarding workflow to end employment")
    if "manager_id" in changes:
        _check_no_loop(emp_id, changes["manager_id"])
    try:
        _record_changes(emp_id, current, changes, user["id"], "edit")
    except IntegrityError:
        raise HTTPException(409, "That email is already in use")
    audit(user, "employee_updated", "employee", emp_id, ",".join(sorted(changes)))
    return _shape(_get_row(emp_id), user)


@router.get("/{emp_id}/history")
def employee_history(emp_id: int, user: dict = Depends(get_current_user)):
    apply_due_changes()
    require_view(user, emp_id)
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT h.*, u.name AS changed_by_name FROM employee_history h LEFT JOIN users u ON u.id = h.changed_by "
                 "WHERE h.employee_id = :id ORDER BY h.id DESC"), {"id": emp_id}).mappings().all()
        pending = conn.execute(
            text("SELECT id, change_type, changes, effective_date FROM pending_job_changes "
                 "WHERE employee_id = :id AND applied = 0 ORDER BY effective_date"), {"id": emp_id}).mappings().all()
    items = [dict(r) for r in rows]
    pend = [{**dict(p), "changes": p["changes"] if isinstance(p["changes"], dict) else json.loads(p["changes"])} for p in pending]
    if not can_see_sensitive(user, emp_id):
        items = [r for r in items if r["field"] not in SENSITIVE_FIELDS]
        pend = [{**p, "changes": {k: v for k, v in p["changes"].items() if k not in SENSITIVE_FIELDS}} for p in pend]
    return {"history": items, "pending": pend}


# ---------- job changes -----------------------------------------------------

@router.post("/{emp_id}/job-change")
def job_change(emp_id: int, body: JobChange, user: dict = Depends(require_hr)):
    current = _get_row(emp_id)
    _ensure_editable(current)
    changes = {k: v for k, v in body.model_dump(include=JOB_CHANGE_FIELDS).items() if v is not None}
    if not changes:
        raise HTTPException(422, "Provide at least one field to change")
    _check_refs(changes)
    if "manager_id" in changes:
        _check_no_loop(emp_id, changes["manager_id"])
    today = utcnow().date()
    if body.effective_date < today and not body.confirm_backdated:
        raise HTTPException(409, "Effective date is in the past. Confirm to record a backdated change.")
    if body.effective_date <= today:
        _record_changes(emp_id, current, changes, user["id"], body.change_type, body.effective_date)
        applied = True
    else:
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO pending_job_changes (employee_id, change_type, changes, effective_date, created_by) "
                     "VALUES (:e, :t, :c, :d, :by)"),
                {"e": emp_id, "t": body.change_type, "c": json.dumps(changes), "d": body.effective_date, "by": user["id"]})
        applied = False
    if "manager_id" in changes:
        send_email(current["email"], "Your reporting manager has changed",
                   f"Effective {body.effective_date}, your reporting line has been updated.")
    audit(user, "job_change", "employee", emp_id, f"{body.change_type} {sorted(changes)} eff {body.effective_date}")
    return {"applied": applied, "effective_date": body.effective_date}


# ---------- offboarding -----------------------------------------------------

@router.post("/{emp_id}/offboarding")
def start_offboarding(emp_id: int, body: OffboardStart, user: dict = Depends(require_hr)):
    current = _get_row(emp_id)
    _ensure_editable(current)
    if current["status"] == "offboarding":
        raise HTTPException(409, "Offboarding already started")
    with engine.begin() as conn:
        reports = conn.execute(
            text("SELECT first_name, last_name FROM employees WHERE manager_id = :id AND status <> 'terminated'"),
            {"id": emp_id}).all()
    if reports:
        names = ", ".join(f"{a} {b}" for a, b in reports[:5])
        raise HTTPException(409, f"Reassign this employee's {len(reports)} direct report(s) first: {names}")
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE employees SET status = 'offboarding', last_working_day = :d, exit_reason = :r, "
                 "exit_checklist = :c WHERE id = :id"),
            {"d": body.last_working_day, "r": f"{body.exit_type}: {body.reason}"[:255],
             "c": json.dumps(DEFAULT_CHECKLIST), "id": emp_id})
        conn.execute(text("INSERT INTO employee_history (employee_id, changed_by, change_type, field, old_value, "
                          "new_value, effective_date) VALUES (:e, :by, 'offboarding', 'status', :o, 'offboarding', :d)"),
                     {"e": emp_id, "by": user["id"], "o": current["status"], "d": body.last_working_day})
    audit(user, "offboarding_started", "employee", emp_id, str(body.last_working_day))
    apply_due_changes()
    return _shape(_get_row(emp_id), user)


@router.post("/{emp_id}/offboarding/checklist")
def toggle_checklist(emp_id: int, body: ChecklistToggle, user: dict = Depends(require_hr)):
    current = _get_row(emp_id)
    if current["status"] != "offboarding":
        raise HTTPException(409, "Employee is not being offboarded")
    items = json.loads(current["exit_checklist"]) if isinstance(current["exit_checklist"], str) else current["exit_checklist"]
    for it in items:
        if it["key"] == body.key:
            it["done"] = body.done
    with engine.begin() as conn:
        conn.execute(text("UPDATE employees SET exit_checklist = :c WHERE id = :id"), {"c": json.dumps(items), "id": emp_id})
    audit(user, "offboarding_checklist", "employee", emp_id, f"{body.key}={body.done}")
    return {"exit_checklist": items}


@router.post("/{emp_id}/offboarding/complete")
def complete_offboarding(emp_id: int, user: dict = Depends(require_hr)):
    current = _get_row(emp_id)
    if current["status"] != "offboarding":
        raise HTTPException(409, "Employee is not being offboarded")
    if current["last_working_day"] > utcnow().date():
        raise HTTPException(409, "The last working day has not arrived yet; access is removed automatically on that day")
    apply_due_changes()
    audit(user, "offboarding_completed", "employee", emp_id)
    return _shape(_get_row(emp_id), user)


# ---------- documents -------------------------------------------------------

def _doc_access(user: dict, emp_id: int) -> None:
    # Documents are sensitive: only HR and the employee themselves (not managers).
    if user["role"] not in HR_ROLES and user.get("employee_id") != emp_id:
        raise HTTPException(403, "Access denied")


@router.get("/{emp_id}/documents")
def list_documents(emp_id: int, user: dict = Depends(get_current_user)):
    _doc_access(user, emp_id)
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT id, category, filename, mime, size, expiry_date, created_at FROM documents "
                                 "WHERE employee_id = :id ORDER BY id DESC"), {"id": emp_id}).mappings().all()
    return [dict(r) for r in rows]


@router.post("/{emp_id}/documents")
async def upload_document(emp_id: int, file: UploadFile = File(...), category: str = Form("other"),
                          expiry_date: str | None = Form(None), user: dict = Depends(get_current_user)):
    _doc_access(user, emp_id)
    _ensure_editable(_get_row(emp_id))
    if category not in DOC_CATEGORIES:
        raise HTTPException(422, "Invalid category")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_UPLOADS:
        raise HTTPException(422, "Only PDF, JPG and PNG files are allowed")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File exceeds the 5 MB limit")
    if not data:
        raise HTTPException(422, "File is empty")
    magic_ok = (ext == ".pdf" and data[:4] == b"%PDF") or (ext in (".jpg", ".jpeg") and data[:3] == b"\xff\xd8\xff") \
        or (ext == ".png" and data[:8] == b"\x89PNG\r\n\x1a\n")
    if not magic_ok:
        raise HTTPException(422, "File content does not match its extension")
    expiry = None
    if expiry_date:
        try:
            expiry = date.fromisoformat(expiry_date)
        except ValueError:
            raise HTTPException(422, "expiry_date must be YYYY-MM-DD")
    stored = f"{uuid.uuid4().hex}{ext}"
    UPLOAD_DIR.mkdir(exist_ok=True)
    (UPLOAD_DIR / stored).write_bytes(data)
    safe_name = Path(file.filename).name[:255]
    with engine.begin() as conn:
        res = conn.execute(
            text("INSERT INTO documents (employee_id, category, filename, stored_name, mime, size, expiry_date, uploaded_by) "
                 "VALUES (:e, :c, :f, :s, :m, :z, :x, :u)"),
            {"e": emp_id, "c": category, "f": safe_name, "s": stored, "m": ALLOWED_UPLOADS[ext], "z": len(data),
             "x": expiry, "u": user["id"]})
    audit(user, "document_uploaded", "employee", emp_id, safe_name)
    return {"id": res.lastrowid}


@router.get("/documents/{doc_id}/download")
def download_document(doc_id: int, user: dict = Depends(get_current_user)):
    with engine.begin() as conn:
        d = conn.execute(text("SELECT * FROM documents WHERE id = :id"), {"id": doc_id}).mappings().first()
    if not d:
        raise HTTPException(404, "Document not found")
    _doc_access(user, d["employee_id"])
    path = UPLOAD_DIR / d["stored_name"]
    if not path.is_file():
        raise HTTPException(404, "File missing from storage")
    audit(user, "document_downloaded", "document", doc_id, d["filename"])
    return FileResponse(path, media_type=d["mime"], filename=d["filename"])


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: int, user: dict = Depends(require_hr)):
    with engine.begin() as conn:
        d = conn.execute(text("SELECT * FROM documents WHERE id = :id"), {"id": doc_id}).mappings().first()
        if not d:
            raise HTTPException(404, "Document not found")
        conn.execute(text("DELETE FROM documents WHERE id = :id"), {"id": doc_id})
    (UPLOAD_DIR / d["stored_name"]).unlink(missing_ok=True)
    audit(user, "document_deleted", "document", doc_id, d["filename"])
    return {"ok": True}
