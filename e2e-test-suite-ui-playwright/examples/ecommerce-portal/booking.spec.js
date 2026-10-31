import { test, expect, allocateSlot, uniqueUser, signUpUI } from './helpers.js'
import { RESOURCES } from '../server/data/resources.js'

const item = RESOURCES[0] // 65/day
const rent = (api, resourceId, win, extra = {}) =>
  api.post('/api/bookings', { data: { resourceId, startsAt: win.startsAt, endsAt: win.endsAt, ...extra } })

async function fillRange(page, win) {
  await page.getByLabel('Pick up').fill(win.startLocal)
  await page.getByLabel('Return').fill(win.endLocal)
}

test.describe('renting through the UI', () => {
  test('signed-in user rents an item and sees it under My rentals', async ({ page }) => {
    const win = allocateSlot()({ days: 2 })
    await signUpUI(page, uniqueUser('renter'))

    await page.goto(`/item/${item.id}`)
    await fillRange(page, win)
    await expect(page.getByText('Estimated total:')).toContainText(`$${(item.price * 2).toFixed(2)}`)
    await page.getByRole('button', { name: 'Rent this item' }).click()

    const confirmation = page.locator('.success')
    await expect(confirmation).toContainText(/Reference RN-[A-Z0-9]{8}/)
    const ref = (await confirmation.textContent()).match(/RN-[A-Z0-9]{8}/)[0]

    // The new rental shows up in the "already booked" list on the item page...
    await expect(page.getByRole('heading', { name: 'Already booked' })).toBeVisible()
    await expect(page.getByText('No upcoming rentals.')).toHaveCount(0)

    // ...and in the user's own rentals, with the server-computed total.
    await page.getByRole('link', { name: 'My rentals' }).click()
    const row = page.getByRole('row', { name: new RegExp(ref) })
    await expect(row).toContainText(item.name)
    await expect(row).toContainText(`$${(item.price * 2).toFixed(2)}`)
    await expect(row).toContainText('confirmed')
  })

  test('a partial extra day is billed as a full started day', async ({ page }) => {
    const win = allocateSlot()({ days: 1, extraHours: 1 }) // 25 hours -> 2 days
    await signUpUI(page, uniqueUser('partial'))
    await page.goto(`/item/${item.id}`)
    await fillRange(page, win)
    await expect(page.getByText('Estimated total:')).toContainText(`$${(item.price * 2).toFixed(2)}`)
    await page.getByRole('button', { name: 'Rent this item' }).click()
    await expect(page.locator('.success')).toBeVisible()
    await page.getByRole('link', { name: 'My rentals' }).click()
    await expect(page.getByRole('row').nth(1)).toContainText(`$${(item.price * 2).toFixed(2)}`)
  })

  test('return before pick up is rejected in the form', async ({ page }) => {
    const win = allocateSlot()()
    await signUpUI(page, uniqueUser('badrange'))
    await page.goto(`/item/${item.id}`)
    await page.getByLabel('Pick up').fill(win.endLocal)
    await page.getByLabel('Return').fill(win.startLocal)
    await expect(page.getByText('Return must be after pick up.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rent this item' })).toBeDisabled()
  })

  test('form blocks a range that overlaps an existing rental', async ({ page, makeApiUser }) => {
    const slot = allocateSlot()
    const { api } = await makeApiUser('holder')
    expect((await rent(api, item.id, slot({ offsetDays: 0, days: 3 }))).status()).toBe(200)

    await signUpUI(page, uniqueUser('blocked'))
    await page.goto(`/item/${item.id}`)
    await fillRange(page, slot({ offsetDays: 1, days: 1 })) // inside the held window
    await expect(page.getByText('That range overlaps an existing rental.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rent this item' })).toBeDisabled()
  })

  test('server answers 409 when someone books the slot after the form loaded (race)', async ({ page, makeApiUser }) => {
    const win = allocateSlot()({ days: 2 })
    await signUpUI(page, uniqueUser('late'))
    await page.goto(`/item/${item.id}`)
    await fillRange(page, win) // form still believes the slot is free
    await expect(page.getByRole('button', { name: 'Rent this item' })).toBeEnabled()

    const { api } = await makeApiUser('winner')
    expect((await rent(api, item.id, win)).status()).toBe(200) // winner takes it first

    await page.getByRole('button', { name: 'Rent this item' }).click()
    await expect(page.locator('.error').first()).toContainText('That time was just booked')
    await expect(page.locator('.success')).toHaveCount(0)
  })

  test('My rentals only lists the signed-in user\'s own rentals', async ({ page, makeApiUser }) => {
    const slot = allocateSlot()
    const { api: other } = await makeApiUser('other')
    expect((await rent(other, RESOURCES[2].id, slot({ days: 1 }))).status()).toBe(200)

    await signUpUI(page, uniqueUser('mine'))
    await page.goto('/account/rentals')
    await expect(page.getByText('No rentals yet.')).toBeVisible()
    await expect(page.getByText(RESOURCES[2].name)).toHaveCount(0)
  })
})

test.describe('booking API: the double-booking guard and validation', () => {
  test('identical window on the same item is rejected with 409', async ({ makeApiUser }) => {
    const win = allocateSlot()({ days: 2 })
    const a = await makeApiUser('a')
    const b = await makeApiUser('b')
    expect((await rent(a.api, item.id, win)).status()).toBe(200)
    const second = await rent(b.api, item.id, win)
    expect(second.status()).toBe(409)
    expect((await second.json()).error).toMatch(/just booked/i)
  })

  test('the same user cannot double-book either', async ({ makeApiUser }) => {
    const win = allocateSlot()({ days: 1 })
    const { api } = await makeApiUser('self')
    expect((await rent(api, item.id, win)).status()).toBe(200)
    expect((await rent(api, item.id, win)).status()).toBe(409)
  })

  test('partial overlaps on either edge are rejected', async ({ makeApiUser }) => {
    const slot = allocateSlot()
    const { api } = await makeApiUser('edges')
    expect((await rent(api, item.id, slot({ offsetDays: 2, days: 3 }))).status()).toBe(200) // days 2-5
    expect((await rent(api, item.id, slot({ offsetDays: 1, days: 2 }))).status()).toBe(409) // 1-3 overlaps start
    expect((await rent(api, item.id, slot({ offsetDays: 4, days: 3 }))).status()).toBe(409) // 4-7 overlaps end
    expect((await rent(api, item.id, slot({ offsetDays: 1, days: 6 }))).status()).toBe(409) // 1-7 engulfs
  })

  test('back-to-back rentals are allowed (end is exclusive)', async ({ makeApiUser }) => {
    const slot = allocateSlot()
    const { api } = await makeApiUser('adjacent')
    expect((await rent(api, item.id, slot({ offsetDays: 1, days: 1 }))).status()).toBe(200)
    expect((await rent(api, item.id, slot({ offsetDays: 2, days: 1 }))).status()).toBe(200) // starts when #1 ends
    expect((await rent(api, item.id, slot({ offsetDays: 0, days: 1 }))).status()).toBe(200) // ends when #1 starts
  })

  test('the same window on a different item is independent', async ({ makeApiUser }) => {
    const win = allocateSlot()({ days: 1 })
    const { api } = await makeApiUser('twoitems')
    expect((await rent(api, RESOURCES[0].id, win)).status()).toBe(200)
    expect((await rent(api, RESOURCES[1].id, win)).status()).toBe(200)
  })

  test('concurrent requests for one slot: exactly one wins', async ({ makeApiUser }) => {
    const win = allocateSlot()({ days: 1 })
    const users = await Promise.all(Array.from({ length: 6 }, (_, i) => makeApiUser(`race${i}`)))
    const statuses = (await Promise.all(users.map(({ api }) => rent(api, item.id, win)))).map((r) => r.status())
    expect(statuses.filter((s) => s === 200)).toHaveLength(1)
    expect(statuses.filter((s) => s === 409)).toHaveLength(statuses.length - 1)
  })

  test('availability endpoint reports a booked window', async ({ makeApiUser }) => {
    const win = allocateSlot()({ days: 1 })
    const { api } = await makeApiUser('avail')
    expect((await rent(api, RESOURCES[3].id, win)).status()).toBe(200)
    const res = await api.get(`/api/availability/${RESOURCES[3].id}`)
    expect(res.ok()).toBe(true)
    const { booked } = await res.json()
    expect(booked.some((b) => new Date(b.startsAt).getTime() === win.start.getTime())).toBe(true)
  })

  test('booking requires a session', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: process.env.E2E_BASE_URL })
    const res = await rent(anon, item.id, allocateSlot()())
    expect(res.status()).toBe(401)
    expect((await anon.get('/api/my-bookings')).status()).toBe(401)
    await anon.dispose()
  })

  test('invalid input is rejected with 400/404', async ({ makeApiUser }) => {
    const slot = allocateSlot()
    const { api } = await makeApiUser('invalid')
    const win = slot()
    expect((await api.post('/api/bookings', { data: { startsAt: win.startsAt, endsAt: win.endsAt } })).status()).toBe(400) // no resource
    expect((await api.post('/api/bookings', { data: { resourceId: item.id, startsAt: 'nope', endsAt: win.endsAt } })).status()).toBe(400)
    expect((await rent(api, item.id, { startsAt: win.endsAt, endsAt: win.startsAt })).status()).toBe(400) // end before start
    const past = new Date(Date.now() - 2 * 24 * 3600 * 1000)
    expect((await rent(api, item.id, { startsAt: past.toISOString(), endsAt: win.endsAt })).status()).toBe(400)
    expect((await rent(api, item.id, slot({ days: 31 }))).status()).toBe(400) // over the 30-day cap
    expect((await rent(api, 999999, slot())).status()).toBe(404)
  })

  test('client-supplied total is ignored: price is computed server-side', async ({ makeApiUser }) => {
    const win = allocateSlot()({ days: 3 })
    const { api } = await makeApiUser('tamper')
    const res = await rent(api, item.id, win, { total: 0.01, price: 0 })
    expect(res.status()).toBe(200)
    expect((await res.json()).total).toBe(item.price * 3)
  })
})
