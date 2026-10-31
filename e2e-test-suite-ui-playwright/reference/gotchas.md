# Gotchas

- **`headless: false` needs a desktop session.** On a headless server/CI box there's no
  display and Chromium fails to launch. This skill's policy is always-headed; if launch fails
  with a display error, tell the user rather than flipping to headless.
- **`reuseExistingServer: false` is deliberate.** `true` would attach to a developer's running
  server, which is pointed at the real database. If the E2E port is taken the run fails loudly
  — good. Change `E2E_PORT` instead.
- **Playwright starts `webServer` before `globalSetup`.** That's why DB prep lives in the
  `webServer.command` chain (`prepare-db.js && npm run dev`) rather than in `globalSetup`.
- **Env precedence.** dotenv never overrides already-set variables, so `webServer.env`
  (test DB, test port, matching auth base URL) beats the app's `.env`. If the app loads env
  with `override: true` or reads a different variable name, adapt `webServer.env` — and
  re-check `prepare-db.js`'s guard still sees the real DB URLs.
- **Auth libraries validate origin/base URL.** Better Auth needs `BETTER_AUTH_URL` and
  trusted origins to match the E2E port, and raw API calls need an `Origin` header
  (`makeApiUser` sets it). Other libs: look for equivalent CSRF/origin settings.
- **`TRUNCATE` and quoting.** Quote reserved-ish names (`"user"`). Use `CASCADE`. Never list
  seed tables in `RESET_TABLES`.
- **Neon pooled vs direct URLs** point at the same database; the guard strips `-pooler` so
  they compare equal. A *branch* on Neon has a different host, which is what you want.
- **`datetime-local` inputs** want `YYYY-MM-DDTHH:mm` in browser-local time; `helpers.js`
  formats this. The app converts to ISO; server comparisons are in UTC.
- **After a test fails, Playwright restarts the worker**, resetting module state. That's why
  `allocateSlot` seeds randomly — a counter restarted at 0 would re-issue used windows.
- **Stale UI state is a feature to test**, not avoid: load the page, change server state via
  API, then act in the UI to prove the server-side guard still holds.
- **Windows:** `&&` chaining in `webServer.command` works under cmd and bash. Paths in specs
  should be URLs, not file paths.
- **Browser download** (`npx playwright install chromium`) can take minutes; run it in the
  background and don't treat it as a hang.
- **`playwright.config.js` is ESM** only if the app's `package.json` has `"type": "module"`;
  otherwise rewrite the imports as `require` and use `.mjs`/`.cjs` consistently.
- **Email validators reject special-use domains.** `@example.test` / `.local` fail Pydantic's
  `EmailStr` (email-validator). Use `@example.com` for generated users.
- **TiDB Cloud / managed MySQL need TLS.** `mysql2` gets `ssl: {rejectUnauthorized: true}`; the
  Python app needs a CA bundle (`?ssl_ca=<certifi.where()>` for PyMySQL). The config derives it
  from the venv's `certifi`. Remote DB round-trips make tests slower: use API setup, not UI.
- **System schemas.** A URL ending in `/sys` (TiDB/MySQL), `/mysql`, `/postgres` is refused.
  Same cluster + credentials is fine as long as the database name is different; prepare-db
  creates a missing database itself.
- **Windows paths with spaces.** Quote absolute paths in `webServer.command`; run python as
  `"<venv>/Scripts/python.exe" -m uvicorn ...` rather than a `.exe` shim relying on PATH.
- **Angular dev server proxy** targets a port in a JSON file; the config writes
  `e2e/.proxy.e2e.json` so the E2E API port is honored (gitignored).
- **Forced-first-login seeds** (`must_change_password`) block every API call but signin/change;
  set the changed password in a worker fixture, never in each test (bcrypt cost + lockout).
- **Lockout tests** must use their own throwaway user; never fail-login the shared admin.
- **Don't mutate globals without restoring.** Tests that change shared settings (probation
  length) or create super admins break other tests' assumptions ("last super admin").
