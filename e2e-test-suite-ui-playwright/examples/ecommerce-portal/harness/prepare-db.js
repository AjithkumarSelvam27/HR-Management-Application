// Runs before the app server starts, with DATABASE_URL = the dedicated TEST database.
// 1. Refuses to continue if the URL points at any database the app itself is configured for.
// 2. Applies the app's schema + seed (idempotent).
// 3. Wipes per-test data so every run starts from the same known state.
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import dotenv from 'dotenv'
import pg from 'pg'

// ADAPT: tables that tests write to, in any order (CASCADE handles FKs). Do NOT list seed tables.
// Quote identifiers that need it (Better Auth's "user" is a reserved-ish word).
const RESET_TABLES = ['bookings', '"session"', '"account"', '"verification"', '"user"']
// ADAPT: the app's command that applies schema and seeds reference data.
const SETUP_COMMAND = process.env.E2E_DB_SETUP_CMD || 'npm run db:setup'

const testUrl = process.env.DATABASE_URL
if (!testUrl) fail('DATABASE_URL (the test DB) is not set.')

// host + port + db name; "-pooler" stripped so a Neon pooled URL equals its direct URL.
function fingerprint(url) {
  const u = new URL(url)
  return `${u.hostname.replace('-pooler', '')}:${u.port || 5432}${u.pathname}`.toLowerCase()
}

function fail(msg) {
  console.error(`\n[e2e prepare-db] REFUSING TO RUN: ${msg}\n`)
  process.exit(1)
}

const testFp = fingerprint(testUrl)

// Compare against every non-test env file in the project (.env, .env.local, .env.production, ...).
const envFiles = fs.readdirSync('.').filter((f) => f.startsWith('.env') && !['.env.test', '.env.example'].includes(f) && !f.endsWith('.example'))
for (const file of envFiles) {
  const parsed = dotenv.parse(fs.readFileSync(file))
  for (const [key, value] of Object.entries(parsed)) {
    if (!/URL|URI|DSN/i.test(key) || !/^postgres/i.test(value)) continue
    if (fingerprint(value) === testFp) {
      fail(`the test database (${testFp}) is the same database as ${key} in ${file}. Use a separate database or Neon branch for E2E.`)
    }
  }
}

console.log(`[e2e prepare-db] test database: ${testFp}`)
execSync(SETUP_COMMAND, { stdio: 'inherit', env: process.env })

const pool = new pg.Pool({ connectionString: testUrl, ssl: { rejectUnauthorized: false } })
try {
  await pool.query(`TRUNCATE ${RESET_TABLES.join(', ')} RESTART IDENTITY CASCADE`)
  console.log(`[e2e prepare-db] reset: ${RESET_TABLES.join(', ')}`)
} finally {
  await pool.end()
}
