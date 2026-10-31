# HRMS — Human Resource Management System

FastAPI (Python) + Angular + MySQL 8. Requirements: see `BRD-HRMS.md`.

## Run locally (Windows, Git Bash)

```bash
# 1. Python deps (venv already created in server/venv)
server/venv/Scripts/activate          # PowerShell/cmd: server\venv\Scripts\activate
pip install -r server/requirements.txt

# 2. JS deps
npm install && npm install --prefix client

# 3. Configure the database
#    Edit server/.env and set DATABASE_URL=mysql+pymysql://user:pass@host:3306/dbname
#    (the database/schema must already exist: CREATE DATABASE hrms CHARACTER SET utf8mb4;)

# 4. Create tables + seed starter org data + first Super Admin
npm run db:setup

# 5. Start API (:8000) and Angular dev server (:4200, proxies /api)
npm run dev
```

Open http://localhost:4200 and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
from `server/.env` (default `admin@company.com` / `ChangeMe123!`). You'll be forced to change the password.

`npm run dev` needs the venv active in the shell so `uvicorn` resolves to it.

## Notes

- **Email is not wired up.** Invites and password-reset links are printed to the API server console
  (`server/mailer.py`). In non-production, the "Add employee" screen also shows the temporary password.
  Replace `send_email` with SMTP/SES/etc. before real use.
- **Production:** `npm run build`, then `npm start` (sets `ENV=production`; FastAPI serves `client/dist/client/browser`).
  Cookies become `Secure`, so serve over HTTPS.
- **Uploads** are stored on local disk in `server/uploads/`.
- **Policy defaults** (BRD §11): one role per user, employee self-edits apply immediately, managers cannot see
  salary, records are soft-deleted only, single company, no MFA/SSO.
- Not built yet (BRD "Could"): MFA/SSO.
