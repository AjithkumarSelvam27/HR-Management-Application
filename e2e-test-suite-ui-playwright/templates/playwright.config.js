import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import dotenv from 'dotenv'
import { defineConfig } from '@playwright/test'

// All E2E settings come from .env.test (gitignored). It must hold a DEDICATED test database —
// never the application's own DATABASE_URL. e2e/prepare-db.js enforces that before every run.
dotenv.config({ path: path.resolve('.env.test'), quiet: true })

const TEST_DB_URL = process.env.E2E_DATABASE_URL
if (!TEST_DB_URL) {
  throw new Error('E2E_DATABASE_URL is not set. Copy .env.test.example to .env.test and fill in a dedicated TEST database URL.')
}

const API_PORT = Number(process.env.E2E_API_PORT || 8100) // ADAPT: ports the dev servers don't normally use
const UI_PORT = Number(process.env.E2E_UI_PORT || 4300)
const UI_URL = `http://localhost:${UI_PORT}`
const API_URL = `http://localhost:${API_PORT}`
process.env.E2E_BASE_URL = UI_URL // helpers read these; workers inherit them
process.env.E2E_API_URL = API_URL

// ADAPT: how the backend is launched. Absolute paths, so spaces in the repo path are fine.
const isWin = process.platform === 'win32'
const serverDir = path.resolve('server')
const venvPython = path.join(serverDir, 'venv', isWin ? 'Scripts/python.exe' : 'bin/python')
process.env.E2E_VENV_PYTHON = venvPython

// ADAPT: translate the neutral test URL into whatever the app's DATABASE_URL expects.
// This app uses SQLAlchemy + PyMySQL and needs a CA bundle to talk TLS to TiDB Cloud.
function appDatabaseUrl(url) {
  const u = new URL(url)
  const ca = execFileSync(venvPython, ['-c', 'import certifi;print(certifi.where())'], { encoding: 'utf8' }).trim()
  return `mysql+pymysql://${u.username}:${u.password}@${u.host}${u.pathname}?ssl_ca=${ca}`
}

// The Angular dev server proxies /api to the E2E backend port (not the dev one, 8000).
const proxyFile = path.resolve('e2e', '.proxy.e2e.json')
fs.writeFileSync(proxyFile, JSON.stringify({ '/api': { target: API_URL, secure: false, changeOrigin: true } }))

const q = (p) => `"${p}"`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  // One worker, no file-level parallelism: tests share one database and one app server.
  // Isolation comes from unique users/names per test, not from parallelism.
  workers: 1,
  fullyParallel: false,
  retries: 0, // a retry hides flakiness; fix the test instead
  forbidOnly: true,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: {
    baseURL: UI_URL,
    headless: false, // ALWAYS headed. Do not change, and do not override with env vars or CLI flags.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      // prepare-db.js refuses to touch the app's real DB, drops + re-applies schema and seed,
      // then the API starts against the test DB.
      command: `node ${q(path.resolve('e2e/prepare-db.js'))} && ${q(venvPython)} -m uvicorn main:app --port ${API_PORT}`,
      cwd: serverDir,
      url: `${API_URL}/api/auth/session`,
      reuseExistingServer: false, // never attach to a server that might be pointed at the real DB
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        // Explicit env wins over server/.env (python-dotenv never overrides existing vars).
        DATABASE_URL: appDatabaseUrl(TEST_DB_URL),
        E2E_DATABASE_URL: TEST_DB_URL,
        ENV: 'development', // dev mode: cookies not Secure, temp passwords returned by the API
        SEED_ADMIN_EMAIL: 'e2e-admin@example.test',
        SEED_ADMIN_PASSWORD: 'Seed-Admin-1',
        APP_URL: UI_URL,
      },
    },
    {
      command: `npx ng serve --port ${UI_PORT} --proxy-config ${q(proxyFile)}`,
      cwd: path.resolve('client'),
      url: UI_URL,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
