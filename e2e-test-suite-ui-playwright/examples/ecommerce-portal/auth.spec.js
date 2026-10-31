import { test, expect, uniqueUser, signUpUI, signInUI, signOutUI } from './helpers.js'

test.describe('authentication', () => {
  test('sign up logs the user in and shows account navigation', async ({ page }) => {
    const user = uniqueUser('signup')
    await signUpUI(page, user)
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('link', { name: 'My rentals' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sign up' })).toHaveCount(0)
  })

  test('sign out then sign in with the same credentials works', async ({ page }) => {
    const user = uniqueUser('roundtrip')
    await signUpUI(page, user)
    await signOutUI(page)
    await expect(page.getByRole('link', { name: 'My rentals' })).toHaveCount(0)

    await page.goto('/login')
    await signInUI(page, user)
    await expect(page.getByText(user.email)).toBeVisible()
  })

  test('wrong password shows an error and stays on the sign-in page', async ({ page, makeApiUser }) => {
    const { user } = await makeApiUser('badpw')
    await page.goto('/login')
    await signInUI(page, { ...user, password: 'definitely-wrong-password' })
    await expect(page.locator('.error')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('link', { name: 'My rentals' })).toHaveCount(0)
  })

  test('duplicate email cannot sign up twice', async ({ page, makeApiUser }) => {
    const { user } = await makeApiUser('dupe')
    await page.goto('/signup')
    await page.getByLabel('Name').fill(user.name)
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill(user.password)
    await page.getByRole('button', { name: 'Sign up' }).click()
    await expect(page.locator('.error')).toBeVisible()
    await expect(page).toHaveURL(/\/signup$/)
  })

  test('anonymous visit to My rentals redirects to sign in and returns after login', async ({ page, makeApiUser }) => {
    const { user } = await makeApiUser('guard')
    await page.goto('/account/rentals')
    await expect(page).toHaveURL(/\/login$/)

    await signInUI(page, user)
    await expect(page).toHaveURL(/\/account\/rentals$/)
    await expect(page.getByRole('heading', { name: 'My rentals' })).toBeVisible()
  })
})
