import path from 'node:path'
import dotenv from 'dotenv'
import { defineConfig } from '@playwright/test'

// All E2E settings come from .env.test (gitignored). It must hold a DEDICATED test database —
// never the application's own DATABASE_URL. e2e/prepare-db.js enforces that before every run.
dotenv.config({ path: path.resolve('.env.test'), quiet: true })

if (!process.env.E2E_DATABASE_URL) {
  throw new Error('E2E_DATABASE_URL is not set. Copy .env.test.example to .env.test and fill in a dedicated TEST database URL.')
}

const PORT = Number(process.env.E2E_PORT || 3100) // ADAPT: any port the app dev server isn't normally on
const BASE_URL = `http://localhost:${PORT}`
process.env.E2E_BASE_URL = BASE_URL // helpers read this; workers inherit it

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  // One worker, no file-level parallelism: tests share one database and one app server.
  // Isolation comes from unique users + unique booking windows per test, not from parallelism.
  workers: 1,
  fullyParallel: false,
  retries: 0, // a retry hides flakiness; fix the test instead
  forbidOnly: true,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: {
    baseURL: BASE_URL,
    headless: false, // ALWAYS headed. Do not change, and do not override with env vars or CLI flags.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // prepare-db.js refuses to touch the app's real DB, applies schema + seed, wipes test data,
    // then the app starts against the test DB.
    command: 'node e2e/prepare-db.js && npm run dev', // ADAPT: the app's dev command
    url: BASE_URL,
    reuseExistingServer: false, // never attach to a server that might be pointed at the real DB
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // Explicit env wins over the app's own .env (dotenv never overrides existing vars).
      DATABASE_URL: process.env.E2E_DATABASE_URL,
      BETTER_AUTH_URL: BASE_URL, // ADAPT: any other base-URL / origin vars the app validates
      BETTER_AUTH_SECRET: process.env.E2E_AUTH_SECRET || 'e2e-only-secret-not-used-anywhere-else-0123456789',
      PORT: String(PORT),
      NODE_ENV: 'development',
    },
  },
})
