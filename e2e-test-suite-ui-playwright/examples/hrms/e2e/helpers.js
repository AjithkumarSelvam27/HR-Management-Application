import crypto from 'node:crypto'
import { test as base, expect } from '@playwright/test'

export { expect }

export const PASSWORD = 'Passw0rd!e2e'
// Matches SEED_ADMIN_* in playwright.config.js. The seeded Super Admin must change its password on
// first login; the `admin` fixture does that once and then uses ADMIN.password.
export const ADMIN = { email: 'e2e-admin@example.test', seedPassword: 'Seed-Admin-1', password: 'Admin-E2e-Pass1' }

export const uid = () => crypto.randomUUID().slice(0, 8)
const isoDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10)
export const today = (offset = 0) => isoDate(offset)

// A small valid PNG header + padding / minimal PDF for the upload rules (magic-byte checked).
export const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
export const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF\n')

export async function loginUI(page, user, password = user.password) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

export async function signOutUI(page) {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
}

export const sidebar = (page) => page.getByRole('navigation')
export const navLink = (page, name) => sidebar(page).getByRole('link', { name, exact: true })

export async function userIdByEmail(api, email) {
  const res = await api.get('/api/users', { params: { q: email } })
  expect(res.ok()).toBeTruthy()
  const u = (await res.json()).find((x) => x.email === email.toLowerCase())
  if (!u) throw new Error(`no user ${email}`)
  return u.id
}

export const test = base.extend({
  // Contexts we create (and must dispose) live here.
  _contexts: [async ({}, use) => {
    const list = []
    await use(list)
    await Promise.all(list.map((c) => c.dispose()))
  }, { scope: 'test' }],

  // Anonymous API client (own cookie jar) talking straight to the backend.
  newApi: async ({ playwright, _contexts }, use) => {
    await use(async () => {
      const api = await playwright.request.newContext({ baseURL: process.env.E2E_API_URL })
      _contexts.push(api)
      return api
    })
  },

  // Super Admin API client (one per worker; the seed admin starts with a forced password change).
  admin: [async ({ playwright }, use) => {
    const api = await playwright.request.newContext({ baseURL: process.env.E2E_API_URL })
    let res = await api.post('/api/auth/signin', { data: { email: ADMIN.email, password: ADMIN.password } })
    if (res.status() === 401) {
      res = await api.post('/api/auth/signin', { data: { email: ADMIN.email, password: ADMIN.seedPassword } })
      if (!res.ok()) throw new Error(`seed admin sign-in failed: ${res.status()} ${await res.text()}`)
      const ch = await api.post('/api/auth/change-password', { data: { current_password: ADMIN.seedPassword, new_password: ADMIN.password } })
      if (!ch.ok()) throw new Error(`seed admin password change failed: ${ch.status()} ${await ch.text()}`)
    } else if (!res.ok()) {
      throw new Error(`admin sign-in failed: ${res.status()} ${await res.text()}`)
    }
    await use(api)
    await api.dispose()
  }, { scope: 'worker' }],

  // Create a real user (employee record + login) through the HR API. Returns the creds.
  // activate:false leaves the temporary password in place (forced-change flow under test).
  provision: async ({ admin, newApi }, use) => {
    await use(async (role = 'employee', { activate = true, ...overrides } = {}) => {
      const id = uid()
      const body = {
        first_name: 'E2E', last_name: `${role}${id}`, email: `e2e-${role}-${id}@example.com`, role,
        join_date: today(-30), salary: 50000, national_id: `NID-${id}`, ...overrides,
      }
      const res = await admin.post('/api/employees', { data: body })
      if (!res.ok()) throw new Error(`provision ${role} failed: ${res.status()} ${await res.text()}`)
      const created = await res.json()
      const user = { ...body, id: created.id, empCode: created.emp_code, name: `${body.first_name} ${body.last_name}`, password: created.temp_password }
      if (activate) {
        const api = await newApi()
        const si = await api.post('/api/auth/signin', { data: { email: user.email, password: created.temp_password } })
        if (!si.ok()) throw new Error(`first sign-in failed: ${si.status()} ${await si.text()}`)
        const ch = await api.post('/api/auth/change-password', { data: { current_password: created.temp_password, new_password: PASSWORD } })
        if (!ch.ok()) throw new Error(`password change failed: ${ch.status()} ${await ch.text()}`)
        user.password = PASSWORD
      }
      return user
    })
  },

  // API client signed in as a provisioned (activated) user.
  apiAs: async ({ newApi }, use) => {
    await use(async (user) => {
      const api = await newApi()
      const res = await api.post('/api/auth/signin', { data: { email: user.email, password: user.password } })
      if (!res.ok()) throw new Error(`apiAs sign-in failed: ${res.status()} ${await res.text()}`)
      return api
    })
  },

  // Browser already signed in as the given provisioned user, on the dashboard.
  signedIn: async ({ page }, use) => {
    await use(async (user) => {
      await loginUI(page, user)
      await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible()
    })
  },
})
