"""Starter org data so a fresh install is usable. Idempotent (inserted only if missing)."""

LOCATIONS = [
    {"name": "Head Office", "address": "1 Main Street", "country": "United States", "timezone": "America/New_York"},
    {"name": "Remote", "address": None, "country": None, "timezone": "UTC"},
]

DEPARTMENTS = [
    {"name": "Human Resources", "code": "HR"},
    {"name": "Engineering", "code": "ENG"},
    {"name": "Finance", "code": "FIN"},
    {"name": "Sales", "code": "SAL"},
]

DESIGNATIONS = [
    {"title": "HR Manager", "grade": "M2"},
    {"title": "Software Engineer", "grade": "E1"},
    {"title": "Senior Software Engineer", "grade": "E2"},
    {"title": "Engineering Manager", "grade": "M2"},
    {"title": "Accountant", "grade": "F1"},
    {"title": "Sales Executive", "grade": "S1"},
]

SETTINGS = {"probation_months": "3", "work_week": "Mon-Fri"}
