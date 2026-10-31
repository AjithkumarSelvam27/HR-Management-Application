import { test, expect, allocateSlot, signInUI } from './helpers.js'
import { RESOURCES } from '../server/data/resources.js'

test.describe('browsing (anonymous)', () => {
  test('home page lists every seeded item with its daily price', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Rent equipment' })).toBeVisible()
    for (const item of RESOURCES) {
      const card = page.locator('.card', { hasText: item.name })
      await expect(card).toBeVisible()
      await expect(card).toContainText(`$${item.price.toFixed(2)} / day`)
    }
  })

  test('opening an item shows its details without signing in', async ({ page }) => {
    const item = RESOURCES[0]
    await page.goto('/')
    await page.getByRole('link', { name: new RegExp(item.name) }).click()
    await expect(page).toHaveURL(new RegExp(`/item/${item.id}$`))
    await expect(page.getByRole('heading', { level: 1, name: item.name })).toBeVisible()
    await expect(page.getByText(`SKU ${item.metadata.sku}`)).toBeVisible()
    await expect(page.getByText(`Deposit $${item.metadata.depositAmount}`)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in to rent' })).toBeDisabled()
  })

  test('unknown item shows an error instead of crashing', async ({ page }) => {
    await page.goto('/item/999999')
    await expect(page.locator('.error')).toContainText('Resource not found')
  })

  test('anonymous user is sent to sign in when renting, then returns to the item', async ({ page, makeApiUser }) => {
    const { user } = await makeApiUser('anonrent')
    const win = allocateSlot()()
    const item = RESOURCES[1]

    await page.goto(`/item/${item.id}`)
    await page.getByLabel('Pick up').fill(win.startLocal)
    await page.getByLabel('Return').fill(win.endLocal)
    await page.getByRole('button', { name: 'Sign in to rent' }).click()
    await expect(page).toHaveURL(/\/login$/)

    await signInUI(page, user)
    await expect(page).toHaveURL(new RegExp(`/item/${item.id}$`))
    await expect(page.getByRole('button', { name: 'Rent this item' })).toBeVisible()
  })
})
