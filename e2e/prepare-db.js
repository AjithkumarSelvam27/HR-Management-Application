// Runs before the app starts (inside the API webServer command, with the TEST database env set).
// 1. Refuses to continue if E2E_DATABASE_URL points at any database the app is configured for,
//    or at a system schema.
// 2. DROPS every table in the test database, then applies the app's schema + seed from scratch.
//    A fresh DB each run means no leftovers between runs AND the migration path is tested too.
// Works for MySQL/TiDB (mysql2) and Postgres (pg). Generic: adapt only the ADAPT lines.
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import dotenv from 'dotenv'

// ADAPT: directories whose .env* files may hold the app's real DB URL(s).
const ENV_DIRS = ['.', 'server', 'client']
// ADAPT: command that applies schema + seed to the DB in DATABASE_URL (idempotent). Runs in `cwd`.
const SETUP_COMMAND = `"${process.env.E2E_VENV_PYTHON}" -m db.migrate`
const SETUP_CWD = path.resolve('server')

const SYSTEM_SCHEMAS = ['sys', 'mysql', 'information_schema', 'performance_schema', 'metrics_schema', 'inspection_schema', 'postgres', 'template0', 'template1']

function fail(msg) {
  console.error(`\n[e2e prepare-db] REFUSING TO RUN: ${msg}\n`)
  process.exit(1)
}

const testUrl = process.env.E2E_DATABASE_URL
if (!testUrl) fail('E2E_DATABASE_URL (the test DB) is not set.')

// Accepts mysql://, mysql+pymysql://, postgres://, postgresql+psycopg://, ... -> family + host:port/db
function parse(url) {
  const m = /^([a-z0-9]+)(?:\+[a-z0-9_]+)?:\/\//i.exec(url)
  if (!m) return null
  const family = /^mysql|^mariadb/i.test(m[1]) ? 'mysql' : /^postgres/i.test(m[1]) ? 'postgres' : null
  if (!family) return null
  const u = new URL(url.replace(/^[a-z0-9]+(\+[a-z0-9_]+)?:/i, 'http:'))
  const port = u.port || (family === 'mysql' ? '3306' : '5432')
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''))
  return { family, u, db, fp: `${u.hostname.replace('-pooler', '')}:${port}/${db}`.toLowerCase() }
}

const test = parse(testUrl)
if (!test) fail('E2E_DATABASE_URL must be a mysql:// or postgres:// URL.')
if (!test.db) fail('E2E_DATABASE_URL must name a database (…/dbname).')
if (SYSTEM_SCHEMAS.includes(test.db.toLowerCase())) fail(`"${test.db}" is a system schema. Use a dedicated database.`)

// Compare against every real env file in the project (.env, .env.local, .env.production, ...).
for (const dir of ENV_DIRS) {
  if (!fs.existsSync(dir)) continue
  for (const file of fs.readdirSync(dir)) {
    if (!file.startsWith('.env') || file === '.env.test' || file.endsWith('.example')) continue
    const full = path.join(dir, file)
    for (const [key, value] of Object.entries(dotenv.parse(fs.readFileSync(full)))) {
      if (!/URL|URI|DSN/i.test(key)) continue
      const other = parse(value)
      if (other && other.fp === test.fp) {
        fail(`the test database (${test.fp}) is the same database as ${key} in ${full}. Use a separate database for E2E.`)
      }
    }
  }
}

console.log(`[e2e prepare-db] test database: ${test.fp}  (ALL TABLES WILL BE DROPPED)`)

const { u } = test
async function resetMysql() {
  const mysql = await import('mysql2/promise')
  const cfg = { host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), ssl: { rejectUnauthorized: true } }
  let conn
  try {
    conn = await mysql.createConnection({ ...cfg, database: test.db })
  } catch (e) {
    if (e.code !== 'ER_BAD_DB_ERROR') throw e
    const admin = await mysql.createConnection(cfg) // db doesn't exist yet: safe, name already vetted above
    await admin.query(`CREATE DATABASE \`${test.db.replace(/`/g, '')}\` CHARACTER SET utf8mb4`)
    await admin.end()
    conn = await mysql.createConnection({ ...cfg, database: test.db })
  }
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0')
    const [rows] = await conn.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()')
    for (const { t } of rows) await conn.query(`DROP TABLE IF EXISTS \`${t}\``)
    await conn.query('SET FOREIGN_KEY_CHECKS = 1')
    console.log(`[e2e prepare-db] dropped ${rows.length} table(s)`)
  } finally {
    await conn.end()
  }
}

async function resetPostgres() {
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: testUrl.replace(/^postgres(ql)?\+[a-z0-9_]+:/i, 'postgres:'), ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    console.log('[e2e prepare-db] reset schema public')
  } finally {
    await client.end()
  }
}

await (test.family === 'mysql' ? resetMysql() : resetPostgres())
execSync(SETUP_COMMAND, { stdio: 'inherit', env: process.env, cwd: SETUP_CWD })
