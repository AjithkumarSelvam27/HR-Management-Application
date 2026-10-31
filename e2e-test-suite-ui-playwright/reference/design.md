# Suite design

## How the harness fits together

```
npm run test:e2e
  └─ playwright.config.js        loads .env.test, sets E2E_BASE_URL/E2E_API_URL, headless:false, workers:1
       ├─ webServer[0] (API)     node e2e/prepare-db.js && <start backend>
       │    ├─ prepare-db.js     DB guard → DROP all tables → run the app's own migrate+seed
       │    └─ backend           on an E2E port, DATABASE_URL = test DB (via webServer.env)
       ├─ webServer[1] (UI)      frontend dev server on an E2E port, proxy → E2E API port
       └─ specs                  drive Chromium (headed) + API contexts against those servers
```
(Single-process apps — e.g. Express serving Vite — use one `webServer` entry.)

- The app is started by Playwright on its own port, pointed at the test DB through explicit
  env vars. dotenv does not override existing env vars, so the app's own `.env` can't leak in.
- `prepare-db.js` runs on every run: guard, DROP every table, run the app's schema+seed. A
  fresh DB means no cross-run leftovers and the migration path is exercised too.
- The reset happens *before* the run only; data from the last run stays for post-mortems.
- The seeded admin is created by the app's seed using `SEED_ADMIN_*` env from the config; the
  `admin` worker fixture completes its forced password change once and reuses the session.

## Isolation model (why tests don't flake)

- One worker, sequential. Shared DB + shared server means parallelism would need per-test
  databases; not worth it at this size.
- Every test creates its own user(s) (`uniqueUser` / `makeApiUser`).
- Every test uses unique names/codes/emails (`uid()`); date-keyed resources get far-future
  random dates. Never assert on global counts unless derived from an API call made in the test.
- Speed: use API contexts (`makeApiUser`) for *setup* that isn't under test; drive the UI for
  the behavior that is.
- A failing test must not poison later ones, so cleanup is never relied on.

## What a good regression suite covers

1. **Auth**: sign up, sign out, sign in, wrong password, duplicate account, guarded route
   redirects and returns to the original page.
2. **Anonymous browsing**: lists render seeded data (imported from the seed module), detail
   pages, unknown ids show an error and don't crash.
3. **Core business flow, end to end through the UI**: the thing users pay for. Assert on the
   confirmation, on the data showing up elsewhere (My rentals), and on money/derived values.
4. **Server-enforced rules via API**: validation (400s), auth (401), not found (404),
   conflicts (409), price computed server-side, user data isolation.
5. **Concurrency / races** where the app claims protection: fire parallel requests, assert
   exactly one winner. Also the UI path where the page is stale when the server rejects.
6. **Boundaries**: inclusive/exclusive edges (back-to-back bookings), limits (max duration),
   partial-unit rounding.

When the user ships a new feature, add specs for it in the same PR; when a bug is fixed, add
the test that would have caught it first.

## Locator and assertion style

- Prefer `getByRole`, `getByLabel`, `getByText`; use CSS classes only when there's no
  accessible handle (`.error`, `.success`, `.card`) — and consider adding `data-testid` to
  the app if those churn.
- Web-first assertions (`await expect(locator).toBeVisible()`); never `waitForTimeout`.
- Assert *what the user sees or the API returns*, never internal state.
- Derive expected numbers from seed data in the test (`item.price * 2`), not magic numbers.

## Keeping it repeatable

- Fixed credentials only for `PASSWORD`; emails are unique per test.
- Dates are generated relative to "now" far in the future — never hardcode calendar dates.
- No `retries`. A flaky test is a bug in the test; fix the cause (usually a missing await on a
  visible state, or shared data).
- Don't depend on test order or on a previous run's leftovers.
