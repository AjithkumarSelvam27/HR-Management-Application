---
name: e2e-test-suite-ui-playwright
description: Build and run a repeatable Playwright UI regression suite for a full-stack web app (any frontend/backend; MySQL, TiDB or Postgres), so bugs aren't introduced by later changes. Use when the user asks to add, generate, update, or run end-to-end / UI automation / regression tests with Playwright, or to check the UI before merging. Always runs the browser headed (headless false) and always asks for a dedicated test database URL — never uses the app's own database.
---

# E2E UI regression suite with Playwright

Creates (first run) or re-runs and extends (later runs) a Playwright suite inside the target
app's repo. The suite is the product: committed, deterministic, runnable on demand with
`npm run test:e2e` before merging. It is not a demo script.

## Non-negotiable rules

1. **Always headed.** `headless: false` in `playwright.config.js`. Never add a headless
   option, env switch, or `--headless` flag, even for CI-looking requests; if the user asks
   for headless, say this skill is configured to always run headed and ask them to confirm
   they want to change that policy.
2. **Always ask for a new test DB URL.** Every invocation of this skill — first build *and*
   every re-run — asks the user (AskUserQuestion) for a dedicated test database URL, even if
   `.env.test` already has one. Offer the existing value as "reuse the one in .env.test" only
   as a convenience option; the user must pick it. Never read the app's own `DATABASE_URL`
   from `.env` and use it for tests, never suggest it.
3. **Never touch the app's database.** `e2e/prepare-db.js` fingerprints the test URL
   (host + port + db name) against every URL in the app's `.env*` files and aborts on a
   match; it also refuses system schemas (`sys`, `mysql`, `postgres`, ...). Keep this guard
   intact. **Every run DROPS all tables in the test DB** — tell the user so.
   - If the URL the user gives fails the guard (same DB as the app, a system schema, a
     placeholder password), do NOT run it and do NOT "fix" it silently: say why and ask again.
     Offering to `CREATE DATABASE <app>_e2e` on the same server with their credentials is a
     valid option, but only when the user picks it (prepare-db creates a missing DB itself).
   - Same server/credentials as the app is acceptable only if the *database name* differs.
4. **Secrets stay local.** The URL goes only into `.env.test` (gitignored — verify
   `.gitignore`). Never write it into specs, config, templates, memory, or the final report.
5. **No global installs, no deploys, no pushes.** Installing `@playwright/test`, `dotenv`
   and the DB driver as dev dependencies and downloading Chromium is expected; say so first.
6. **Tests must be able to fail.** Assert on concrete outcomes (text, URL, status codes,
   DB-enforced behavior), not "page loaded". Prove at least one assertion is live (Step 6).

## Step 0 — Understand the app

Read, don't guess: `package.json` files (dev/build/db scripts, `type`), server entry + routes,
DB schema and seed, every page/component the user can reach, auth setup, any requirements doc
(BRD) — tests should cite requirement IDs. Write down:
- how to start backend and frontend (ports, proxy config), and how each picks its DB / base URL
- how `DATABASE_URL` is shaped for the app's driver (e.g. `mysql+pymysql://…?ssl_ca=…` vs the
  neutral `mysql://…` the user pastes) and any TLS requirements (TiDB Cloud needs TLS)
- the seed data, the seeded admin credentials, and any forced first-login flows
- user-visible flows, server-enforced business rules, and exact error messages
- whether the API returns anything test-friendly in non-production (e.g. temp passwords)

If the app cannot apply its schema from scripts, tell the user — that's an app gap.

## Step 1 — Ask for the test database

AskUserQuestion: "Paste a connection URL for a *dedicated test database*
(`mysql://user:pass@host:port/dbname` or `postgres://…`). All its tables are dropped and
re-created on every run. Not your app's DB." Pre-validate with the same fingerprint logic as
`prepare-db.js` (can be done by running it with `E2E_DATABASE_URL` set — it fails fast before
connecting). Reject: same host:port/db as any app `.env*`, system schemas, placeholders like
`<PASSWORD>`. If the user answers without a URL, ask again; meanwhile keep building (writing
tests needs no DB) and stop before the run.

## Step 2 — Install

In the app dir: `npm i -D @playwright/test dotenv mysql2` (or `pg` for Postgres), then
`npx playwright install chromium` (minutes; run in background). Add scripts
`"test:e2e": "playwright test"`, `"test:e2e:report": "playwright show-report e2e-report"`.
If `package.json` lacks `"type": "module"`, add it (check nothing else in the root relies on
CJS) — the templates are ESM. Append to `.gitignore`: `.env.test`, `e2e-results/`,
`e2e-report/`, `playwright-report/`, `test-results/`, `e2e/.proxy.e2e.json`.

## Step 3 — Scaffold from templates

Copy from `templates/` (this skill's directory) and resolve every `ADAPT:` comment:
- `templates/playwright.config.js` → app root (ports, server start commands, DB-URL translation,
  seed admin env, one `webServer` per process: API + UI dev server)
- `templates/e2e/prepare-db.js`, `templates/e2e/helpers.js` → `e2e/`
- `templates/.env.test.example` → app root (committed); write the real `.env.test` from Step 1

The templates are the HRMS (FastAPI + Angular + MySQL) harness, generalized with `ADAPT:`
markers; `examples/ecommerce-portal/harness/` is the Express + React + Postgres variant.
`reference/design.md` explains the harness; read `reference/gotchas.md` before editing it.
Invariants: separate ports from dev, `reuseExistingServer: false`, env passed via
`webServer.env` (beats the app's `.env`), one worker, no retries, `headless: false`,
fresh DB each run.

## Step 4 — Write the specs

Group by feature in `e2e/*.spec.js`. Coverage checklist (adapt to the app): auth (first-login
forced change, bad credentials, lockout, register, route guards + return-to, sign-out
invalidates server session), per-role navigation and denied pages, server-side data scope and
sensitive-field hiding, every create/edit flow through the UI with the result verified via the
API, each server-enforced rule through the API (validation, 401/403/404/409/422, uniqueness,
loops, last-admin protections), audit trail, dashboards (UI numbers equal API numbers), and any
race/concurrency guard. Worked suites: `examples/hrms/` (role-based HR app) and
`examples/ecommerce-portal/` (booking flow).
Rules for every test: its own users via a `provision`-style fixture, unique names via `uid()`,
no ordering dependence, no `waitForTimeout` (web-first assertions), tests that change shared
settings restore them, never assert on counts of shared data unless derived from the API.

## Step 5 — Run

`npm run test:e2e` (a visible Chromium window opens; tell the user not to close it). On
failures: read the error, open `e2e-results/*/` trace/screenshot, and decide whether the
**app** or the **test** is wrong. Never weaken an assertion to make it pass. If it's an app
bug, report it with the failing test rather than silently fixing app code (unless asked).
A locator/message mismatch from writing tests against source without running them is a test
bug: fix the test only after confirming the app behavior is the intended one.

## Step 6 — Prove the suite can fail

Before calling it done, deliberately break one thing the suite protects (e.g. disable the
lockout, drop the manager-scope filter), run the relevant spec, confirm it goes red, then
**revert** and confirm green. Report this. If the app can't be safely mutated, say you skipped
it and why.

## Step 7 — Handoff

Report: pass/fail counts from the final run, what the suite covers, how to run it
(`npm run test:e2e`, `npx playwright test e2e/auth.spec.js`, `npm run test:e2e:report`), that it
drops/recreates the test DB each run, where `.env.test` lives, side effects outside the DB
(e.g. files written to `server/uploads/`), and what is not covered. On re-runs say which tests
were added/changed and why.
