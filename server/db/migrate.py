import os
import re
import uuid
from pathlib import Path

from sqlalchemy import text

from auth import hash_password
from data.seed import DEPARTMENTS, DESIGNATIONS, LOCATIONS, SETTINGS
from db import engine


def _statements(sql: str) -> list[str]:
    # schema.sql is simple and fully controlled (no procedures, no ';' inside literals),
    # so a naive split is safe; PyMySQL will not run multiple statements per execute().
    return [s.strip() for s in re.split(r";\s*\n", sql) if s.strip()]


def migrate() -> None:
    schema_sql = Path(__file__).parent.joinpath("schema.sql").read_text()
    with engine.begin() as conn:
        for statement in _statements(schema_sql):
            conn.execute(text(statement))

        for loc in LOCATIONS:
            conn.execute(
                text("INSERT INTO locations (name, address, country, timezone) "
                     "VALUES (:name, :address, :country, :timezone) ON DUPLICATE KEY UPDATE name = name"), loc)
        for d in DEPARTMENTS:
            conn.execute(text("INSERT INTO departments (name, code) VALUES (:name, :code) "
                              "ON DUPLICATE KEY UPDATE name = name"), d)
        for d in DESIGNATIONS:
            conn.execute(text("INSERT INTO designations (title, grade) VALUES (:title, :grade) "
                              "ON DUPLICATE KEY UPDATE title = title"), d)
        for k, v in SETTINGS.items():
            conn.execute(text("INSERT INTO settings (k, v) VALUES (:k, :v) ON DUPLICATE KEY UPDATE k = k"),
                         {"k": k, "v": v})

        has_admin = conn.execute(text("SELECT 1 FROM users WHERE role = 'super_admin' LIMIT 1")).first()
        if not has_admin:
            email = os.environ.get("SEED_ADMIN_EMAIL", "admin@company.com")
            password = os.environ.get("SEED_ADMIN_PASSWORD", "ChangeMe123!")
            conn.execute(
                text("INSERT INTO users (id, email, password_hash, name, role, must_change_password) "
                     "VALUES (:id, :email, :ph, 'Super Admin', 'super_admin', 1)"),
                {"id": str(uuid.uuid4()), "email": email, "ph": hash_password(password)},
            )
            print(f"Seeded Super Admin: {email} (must change password on first login)")

    print("Migrated schema and seeded starter org data.")


if __name__ == "__main__":
    migrate()
