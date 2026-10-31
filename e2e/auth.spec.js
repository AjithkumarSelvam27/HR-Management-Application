import { test, expect, loginUI, signOutUI, uid, userIdByEmail, PASSWORD, navLink } from './helpers.js'

test.describe('sign in / password rules', () => {
  test('first login with a temporary password forces a password change (AUTH-02)', async ({ page, provision }) => {
    const user = await provision('employee', { activate: false })
    await loginUI(page, user)
    await expect(page).toHaveURL(/\/change-password/)
    await expect(page.getByText('you must set a new password')).toBeVisible()
    await expect(page.getByRole('navigation')).toHaveCount(0) // app shell hidden until changed

    await page.getByLabel('Current (temporary) password').fill('not-the-password-1')
    await page.getByLabel('New password').fill('Another-Pass1')
    await page.getByRole('button', { name: 'Update password' }).click()
    await expect(page.locator('.error')).toHaveText('Current password is incorrect')

    await page.getByLabel('Current (temporary) password').fill(user.password)
    await page.getByLabel('New password').fill('short')
    await page.getByRole('button', { name: 'Update password' }).click()
    await expect(page.locator('.error')).toHaveText('Password must be at least 8 characters and contain a letter and a number')

    await page.getByLabel('New password').fill(user.password)
    await page.getByRole('button', { name: 'Update password' }).click()
    await expect(page.locator('.error')).toHaveText('New password must differ from the current one')

    await page.getByLabel('New password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Update password' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: `Welcome, ${user.name}` })).toBeVisible()

    // the new password works from a clean sign-in, the temporary one no longer does
    await signOutUI(page)
    await loginUI(page, user, user.password)
    await expect(page.locator('.error')).toHaveText('Invalid email or password')
    await loginUI(page, user, PASSWORD)
    await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible()
  })

  test('wrong password and unknown email give the same generic error', async ({ page, provision }) => {
    const user = await provision('employee')
    await loginUI(page, user, 'Wrong-Pass-123')
    await expect(page.locator('.error')).toHaveText('Invalid email or password')
    await loginUI(page, { email: `nobody-${uid()}@example.com` }, 'Wrong-Pass-123')
    await expect(page.locator('.error')).toHaveText('Invalid email or password')
    await expect(page).toHaveURL(/\/login/)
  })

  test('account locks after 5 failed attempts, even for the right password (AUTH-04)', async ({ page, provision, newApi }) => {
    const user = await provision('employee')
    const api = await newApi()
    for (let i = 0; i < 5; i++) {
      const res = await api.post('/api/auth/signin', { data: { email: user.email, password: 'Wrong-Pass-123' } })
      expect(res.status()).toBe(401)
    }
    await loginUI(page, user) // correct password
    await expect(page.locator('.error')).toContainText('Account locked due to failed attempts')
    await expect(page).toHaveURL(/\/login/)
  })

  test('HR can unlock a locked account and the user can sign in again', async ({ page, provision, newApi, admin }) => {
    const user = await provision('employee')
    const api = await newApi()
    for (let i = 0; i < 5; i++) await api.post('/api/auth/signin', { data: { email: user.email, password: 'Wrong-Pass-123' } })
    const locked = await api.post('/api/auth/signin', { data: { email: user.email, password: user.password } })
    expect(locked.status()).toBe(423)
    const id = await userIdByEmail(admin, user.email)
    expect((await admin.post(`/api/users/${id}/unlock`)).ok()).toBeTruthy()
    await loginUI(page, user)
    await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible()
  })

  test('deactivated users cannot sign in and lose their live session (AUTH-08)', async ({ page, provision, admin, signedIn }) => {
    const user = await provision('employee')
    await signedIn(user)
    const id = await userIdByEmail(admin, user.email)
    expect((await admin.patch(`/api/users/${id}`, { data: { active: false } })).ok()).toBeTruthy()

    expect(await (await page.request.get('/api/auth/session')).json()).toBeNull() // existing session revoked
    await page.context().clearCookies()
    await loginUI(page, user)
    await expect(page.locator('.error')).toHaveText('Account is deactivated. Contact HR.')
  })
})

test.describe('self registration', () => {
  test('registers a least-privileged account and lands on the dashboard', async ({ page }) => {
    const email = `e2e-reg-${uid()}@example.com`
    await page.goto('/register')
    await page.getByLabel('Full name').fill('Reggie Register')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Register' }).click()
    await expect(page.getByRole('heading', { name: 'Welcome, Reggie Register' })).toBeVisible()
    await expect(page.locator('.topbar .badge')).toHaveText('employee')
    await expect(navLink(page, 'Employees')).toHaveCount(0)
    await expect(navLink(page, 'Users & roles')).toHaveCount(0)
  })

  test('rejects mismatched passwords, weak passwords and duplicate emails', async ({ page, provision }) => {
    const existing = await provision('employee')
    await page.goto('/register')
    await page.getByLabel('Full name').fill('Dup Licate')
    await page.getByLabel('Email').fill(existing.email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill('Different-Pass1')
    await page.getByRole('button', { name: 'Register' }).click()
    await expect(page.locator('.error')).toHaveText('Passwords do not match')

    await page.getByLabel('Password', { exact: true }).fill('onlyletters')
    await page.getByLabel('Confirm password').fill('onlyletters')
    await page.getByRole('button', { name: 'Register' }).click()
    await expect(page.locator('.error')).toHaveText('Password must be at least 8 characters and contain a letter and a number')

    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Register' }).click()
    await expect(page.locator('.error')).toHaveText('An account with this email already exists')
    await expect(page).toHaveURL(/\/register/)
  })
})

test.describe('sessions and route guards', () => {
  test('anonymous visit to a guarded page redirects to login and returns after sign-in', async ({ page, provision }) => {
    const hr = await provision('hr_admin')
    await page.goto('/employees')
    await expect(page).toHaveURL(/\/login\?from=%2Femployees/)
    await loginUI(page, hr)
    await expect(page).toHaveURL(/\/employees$/)
    await expect(page.getByRole('heading', { name: 'Employees', exact: true })).toBeVisible()
  })

  test('signed-in users are bounced away from /login', async ({ page, provision, signedIn }) => {
    await signedIn(await provision('employee'))
    await page.goto('/login')
    await expect(page).toHaveURL(/\/$/)
  })

  test('sign-out ends the session on the server, not just in the browser (AUTH-07)', async ({ page, provision, signedIn, newApi }) => {
    await signedIn(await provision('employee'))
    const token = (await page.context().cookies()).find((c) => c.name === 'session')?.value
    expect(token).toBeTruthy()
    await signOutUI(page)

    const replay = await newApi()
    const res = await replay.get('/api/auth/session', { headers: { cookie: `session=${token}` } })
    expect(await res.json()).toBeNull()
    const protectedRes = await replay.get('/api/dashboard', { headers: { cookie: `session=${token}` } })
    expect(protectedRes.status()).toBe(401)
  })

  test('forgot-password never reveals whether an account exists (AUTH-03)', async ({ page, provision }) => {
    const known = await provision('employee')
    for (const email of [known.email, `ghost-${uid()}@example.com`]) {
      await page.goto('/forgot-password')
      await page.getByLabel('Email').fill(email)
      await page.getByRole('button', { name: 'Send reset link' }).click()
      await expect(page.locator('.success')).toHaveText('If the account exists, an email was sent.')
    }
  })

  test('an invalid reset token is rejected', async ({ page }) => {
    await page.goto('/reset-password?token=bogus-token')
    await page.getByLabel('New password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Update password' }).click()
    await expect(page.locator('.error')).toHaveText('This reset link is invalid or has expired')
  })
})
