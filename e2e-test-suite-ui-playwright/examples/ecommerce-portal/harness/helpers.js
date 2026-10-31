import crypto from 'node:crypto'
import { test as base, expect } from '@playwright/test'

export { expect }

export const PASSWORD = 'Passw0rd!e2e'

// Every test makes its own user: no shared state between tests, no ordering dependence.
export function uniqueUser(label = 'user') {
  const id = crypto.randomUUID().slice(0, 8)
  return { name: `E2E ${label} ${id}`, email: `e2e-${label}-${id}@example.test`, password: PASSWORD }
}

// ADAPT: labels/buttons/routes of the app's auth pages.
export async function signUpUI(page, user) {
  await page.goto('/signup')
  await page.getByLabel('Name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign up' }).click()
  await expect(page.getByText(user.email)).toBeVisible()
}

export async function signInUI(page, user) {
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

export async function signOutUI(page) {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
}

const pad = (n) => String(n).padStart(2, '0')
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

// Time-range allocator. Each call hands out a fresh 10-day slot far in the future, so tests never
// collide on the same resource even though they share one database. The random seed means a
// restarted worker (after a failure) doesn't re-issue slots used earlier in the same run.
// Within a slot, use offsetDays 0..8 to build related windows (adjacent, overlapping, ...).
let nextSlot = 30 + Math.floor(Math.random() * 20_000)
export function allocateSlot() {
  const slotStart = nextSlot
  nextSlot += 10
  return function window({ offsetDays = 0, days = 1, hour = 10, extraHours = 0 } = {}) {
    const start = new Date()
    start.setHours(hour, 0, 0, 0)
    start.setDate(start.getDate() + slotStart + offsetDays)
    const end = new Date(start)
    end.setDate(end.getDate() + days)
    end.setHours(end.getHours() + extraHours)
    return { start, end, startLocal: toLocalInput(start), endLocal: toLocalInput(end), startsAt: start.toISOString(), endsAt: end.toISOString() }
  }
}

export const test = base.extend({
  // Factory for users that talk to the API directly (own cookie jar each) — fast setup and
  // true concurrency, without driving the UI for things that aren't under test.
  makeApiUser: async ({ playwright }, use) => {
    const contexts = []
    await use(async (label) => {
      const origin = process.env.E2E_BASE_URL
      const api = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } })
      contexts.push(api)
      const user = uniqueUser(label)
      const res = await api.post('/api/auth/sign-up/email', { data: user }) // ADAPT: auth sign-up endpoint
      if (!res.ok()) throw new Error(`API sign-up failed: ${res.status()} ${await res.text()}`)
      return { api, user }
    })
    await Promise.all(contexts.map((c) => c.dispose()))
  },
})
