from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from auth import audit, get_current_user, require_hr
from db import engine

router = APIRouter()


class LocationBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    address: str | None = None
    country: str | None = None
    timezone: str | None = None
    active: bool = True


class DepartmentBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=20)
    parent_id: int | None = None
    head_employee_id: int | None = None
    active: bool = True


class DesignationBody(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    grade: str | None = None
    department_id: int | None = None
    active: bool = True


class HolidayBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    holiday_date: date


class ReassignBody(BaseModel):
    target_department_id: int


def _dup_guard(fn):
    try:
        return fn()
    except IntegrityError as e:
        code = e.orig.args[0] if e.orig and e.orig.args else None
        if code == 1062:
            raise HTTPException(409, "A record with that name or code already exists")
        if code == 1451:
            raise HTTPException(409, "This record is still in use")
        if code == 1452:
            raise HTTPException(422, "Referenced record does not exist")
        raise


# ---------- generic helpers -------------------------------------------------

def _list(table: str, order: str, user_scope=True):
    with engine.begin() as conn:
        rows = conn.execute(text(f"SELECT * FROM {table} ORDER BY {order}")).mappings().all()
    return [dict(r) for r in rows]


def _insert(table: str, data: dict) -> int:
    cols = ", ".join(data)
    vals = ", ".join(f":{k}" for k in data)
    with engine.begin() as conn:
        res = conn.execute(text(f"INSERT INTO {table} ({cols}) VALUES ({vals})"), data)
        return res.lastrowid


def _update(table: str, id_: int, data: dict) -> None:
    sets = ", ".join(f"{k} = :{k}" for k in data)
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE {table} SET {sets} WHERE id = :_id"), {**data, "_id": id_})
        exists = conn.execute(text(f"SELECT 1 FROM {table} WHERE id = :id"), {"id": id_}).first()
    if not exists:
        raise HTTPException(404, "Not found")


# ---------- locations -------------------------------------------------------

@router.get("/locations")
def list_locations(user: dict = Depends(get_current_user)):
    return _list("locations", "name")


@router.post("/locations")
def create_location(body: LocationBody, user: dict = Depends(require_hr)):
    id_ = _dup_guard(lambda: _insert("locations", body.model_dump()))
    audit(user, "location_created", "location", id_, body.name)
    return {"id": id_}


@router.put("/locations/{id_}")
def update_location(id_: int, body: LocationBody, user: dict = Depends(require_hr)):
    _dup_guard(lambda: _update("locations", id_, body.model_dump()))
    audit(user, "location_updated", "location", id_, body.name)
    return {"ok": True}


# ---------- departments -----------------------------------------------------

def _check_parent(dept_id: int | None, parent_id: int | None) -> None:
    """Reject self-parenting and circular department hierarchies (ORG-04)."""
    if parent_id is None:
        return
    if dept_id is not None and parent_id == dept_id:
        raise HTTPException(422, "A department cannot be its own parent")
    with engine.begin() as conn:
        cur = parent_id
        seen = set()
        while cur is not None:
            if dept_id is not None and cur == dept_id:
                raise HTTPException(422, "That parent would create a circular hierarchy")
            if cur in seen:
                break
            seen.add(cur)
            row = conn.execute(text("SELECT parent_id FROM departments WHERE id = :id"), {"id": cur}).first()
            if row is None:
                raise HTTPException(422, "Parent department does not exist")
            cur = row[0]


@router.get("/departments")
def list_departments(user: dict = Depends(get_current_user)):
    with engine.begin() as conn:
        rows = conn.execute(text(
            "SELECT d.*, p.name AS parent_name, "
            "(SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.status <> 'terminated') AS employee_count, "
            "CONCAT(h.first_name, ' ', h.last_name) AS head_name "
            "FROM departments d LEFT JOIN departments p ON p.id = d.parent_id "
            "LEFT JOIN employees h ON h.id = d.head_employee_id ORDER BY d.name")).mappings().all()
    return [dict(r) for r in rows]


@router.post("/departments")
def create_department(body: DepartmentBody, user: dict = Depends(require_hr)):
    _check_parent(None, body.parent_id)
    id_ = _dup_guard(lambda: _insert("departments", body.model_dump()))
    audit(user, "department_created", "department", id_, body.name)
    return {"id": id_}


@router.put("/departments/{id_}")
def update_department(id_: int, body: DepartmentBody, user: dict = Depends(require_hr)):
    _check_parent(id_, body.parent_id)
    if not body.active:
        with engine.begin() as conn:
            n = conn.execute(text("SELECT COUNT(*) FROM employees WHERE department_id = :d AND status <> 'terminated'"),
                             {"d": id_}).scalar()
        if n:
            raise HTTPException(409, f"{n} active employee(s) are in this department. Reassign them before deactivating.")
    _dup_guard(lambda: _update("departments", id_, body.model_dump()))
    audit(user, "department_updated", "department", id_, body.name)
    return {"ok": True}


@router.post("/departments/{id_}/reassign")
def reassign_department(id_: int, body: ReassignBody, user: dict = Depends(require_hr)):
    if body.target_department_id == id_:
        raise HTTPException(422, "Target must be a different department")
    with engine.begin() as conn:
        if not conn.execute(text("SELECT 1 FROM departments WHERE id = :id AND active = 1"),
                            {"id": body.target_department_id}).first():
            raise HTTPException(422, "Target department does not exist or is inactive")
        emps = conn.execute(text("SELECT id FROM employees WHERE department_id = :d AND status <> 'terminated'"),
                            {"d": id_}).all()
        for (eid,) in emps:
            conn.execute(text("INSERT INTO employee_history (employee_id, changed_by, change_type, field, old_value, "
                              "new_value) VALUES (:e, :by, 'transfer', 'department_id', :o, :n)"),
                         {"e": eid, "by": user["id"], "o": str(id_), "n": str(body.target_department_id)})
        conn.execute(text("UPDATE employees SET department_id = :t WHERE department_id = :d AND status <> 'terminated'"),
                     {"t": body.target_department_id, "d": id_})
    audit(user, "department_reassigned", "department", id_, f"{len(emps)} employees -> {body.target_department_id}")
    return {"moved": len(emps)}


# ---------- designations ----------------------------------------------------

@router.get("/designations")
def list_designations(user: dict = Depends(get_current_user)):
    return _list("designations", "title")


@router.post("/designations")
def create_designation(body: DesignationBody, user: dict = Depends(require_hr)):
    id_ = _dup_guard(lambda: _insert("designations", body.model_dump()))
    audit(user, "designation_created", "designation", id_, body.title)
    return {"id": id_}


@router.put("/designations/{id_}")
def update_designation(id_: int, body: DesignationBody, user: dict = Depends(require_hr)):
    _dup_guard(lambda: _update("designations", id_, body.model_dump()))
    audit(user, "designation_updated", "designation", id_, body.title)
    return {"ok": True}


# ---------- holidays & settings ---------------------------------------------

@router.get("/holidays")
def list_holidays(user: dict = Depends(get_current_user)):
    return _list("holidays", "holiday_date")


@router.post("/holidays")
def create_holiday(body: HolidayBody, user: dict = Depends(require_hr)):
    id_ = _dup_guard(lambda: _insert("holidays", body.model_dump()))
    audit(user, "holiday_created", "holiday", id_, body.name)
    return {"id": id_}


@router.delete("/holidays/{id_}")
def delete_holiday(id_: int, user: dict = Depends(require_hr)):
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM holidays WHERE id = :id"), {"id": id_})
    audit(user, "holiday_deleted", "holiday", id_)
    return {"ok": True}


@router.get("/settings")
def get_settings(user: dict = Depends(get_current_user)):
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT k, v FROM settings")).all()
    return {k: v for k, v in rows}


@router.put("/settings")
def put_settings(body: dict[str, str], user: dict = Depends(require_hr)):
    allowed = {"probation_months", "work_week"}
    with engine.begin() as conn:
        for k, v in body.items():
            if k in allowed:
                conn.execute(text("INSERT INTO settings (k, v) VALUES (:k, :v) ON DUPLICATE KEY UPDATE v = :v"),
                             {"k": k, "v": v[:255]})
    audit(user, "settings_updated", "settings")
    return {"ok": True}


# ---------- org chart -------------------------------------------------------

@router.get("/org-chart")
def org_chart(user: dict = Depends(get_current_user)):
    with engine.begin() as conn:
        rows = conn.execute(text(
            "SELECT e.id, e.first_name, e.last_name, e.manager_id, d.name AS department, g.title AS designation "
            "FROM employees e LEFT JOIN departments d ON d.id = e.department_id "
            "LEFT JOIN designations g ON g.id = e.designation_id WHERE e.status <> 'terminated'")).mappings().all()
    nodes = {r["id"]: {"id": r["id"], "name": f"{r['first_name']} {r['last_name']}", "department": r["department"],
                       "designation": r["designation"], "children": []} for r in rows}
    roots = []
    for r in rows:
        parent = nodes.get(r["manager_id"])
        (parent["children"] if parent else roots).append(nodes[r["id"]])
    return roots
