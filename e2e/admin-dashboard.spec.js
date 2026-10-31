import { test, expect, loginUI, userIdByEmail, ADMIN, PASSWORD } from './helpers.js'

test.describe('users & roles (ADM-01, ADM-02)', () => {
  test('HR changes a role and deactivates a user from the Users screen', async ({ page, provision, signedIn, admin }) => {
    const hr = await provision('hr_admin')
    const emp = await provision('employee')
    await signedIn(hr)
    await page.goto('/admin/users')
    await page.getByLabel('Search').fill(emp.email)
    await page.getByLabel('Search').press('Enter')
    const row = page.locator('tbody tr', { hasText: emp.email })
    await expect(row).toHaveCount(1)

    await row.getByRole('combobox').selectOption('manager')
    await expect(page.locator('.success')).toBeVisible()
    const id = await userIdByEmail(admin, emp.email)
    const after = await (await admin.get('/api/users', { params: { q: emp.email } })).json()
    expect(after[0]).toMatchObject({ id, role: 'manager' })

    await row.getByRole('button', { name: 'Deactivate' }).click()
    await expect(row.locator('.badge').first()).toHaveText('deactivated')
    await row.getByRole('button', { name: 'Reactivate' }).click()
    await expect(row.locator('.badge').first()).toHaveText('active')
  })

  test('only a Super Admin can touch admin accounts; the last one is protected', async ({ provision, apiAs, admin }) => {
    const hr = await apiAs(await provision('hr_admin'))
    const emp = await provision('employee')
    const empId = await userIdByEmail(admin, emp.email)
    const superId = await userIdByEmail(admin, ADMIN.email)

    const promote = await hr.patch(`/api/users/${empId}`, { data: { role: 'hr_admin' } })
    expect(promote.status()).toBe(403)
    expect((await promote.json()).error).toBe('Only a Super Admin can manage admin accounts')
    expect((await hr.patch(`/api/users/${superId}`, { data: { active: false } })).status()).toBe(403)

    const demote = await admin.patch(`/api/users/${superId}`, { data: { role: 'hr_admin' } })
    expect(demote.status()).toBe(409)
    expect((await demote.json()).error).toBe('The last Super Admin cannot be demoted or deactivated')
    const off = await admin.patch(`/api/users/${superId}`, { data: { active: false } })
    expect(off.status()).toBe(409)
    expect((await admin.get('/api/auth/session')).ok()).toBeTruthy() // still signed in
  })

  test('resending an invite resets the account to a pending temporary password', async ({ provision, admin, newApi }) => {
    const emp = await provision('employee')
    const id = await userIdByEmail(admin, emp.email)
    expect((await admin.post(`/api/users/${id}/resend-invite`)).ok()).toBeTruthy()
    const api = await newApi()
    expect((await api.post('/api/auth/signin', { data: { email: emp.email, password: PASSWORD } })).status()).toBe(401)
    const users = await (await admin.get('/api/users', { params: { q: emp.email } })).json()
    expect(users[0].must_change_password).toBeTruthy()
  })
})

test.describe('audit log (ADM-03, ADM-04)', () => {
  test('failed logins and employee creation are recorded and filterable', async ({ page, provision, signedIn, newApi, admin }) => {
    const hr = await provision('hr_admin')
    const victim = await provision('employee')
    const api = await newApi()
    await api.post('/api/auth/signin', { data: { email: victim.email, password: 'Wrong-Pass-123' } })

    const failed = await (await admin.get('/api/audit-log', { params: { user_email: victim.email, action: 'login_failed' } })).json()
    expect(failed.total).toBeGreaterThanOrEqual(1)
    const byAdmin = await (await admin.get('/api/audit-log', { params: { action: 'employee_created' } })).json()
    expect(byAdmin.items.some((r) => r.detail === victim.email)).toBeTruthy()

    await signedIn(hr)
    await page.goto('/admin/audit')
    await page.getByLabel('User email').fill(victim.email)
    await page.getByRole('button', { name: 'Filter' }).click()
    await expect(page.locator('tbody tr', { hasText: 'login_failed' }).first()).toContainText(victim.email)
  })

  test('the audit log is not accessible to non-HR roles', async ({ provision, apiAs }) => {
    expect((await (await apiAs(await provision('manager'))).get('/api/audit-log')).status()).toBe(403)
  })
})

test.describe('dashboards (DASH-01..04)', () => {
  test('HR KPI tiles match the API numbers', async ({ page, provision, signedIn, admin }) => {
    const hr = await provision('hr_admin')
    await provision('employee')
    await signedIn(hr)
    const { kpis } = await (await page.request.get('/api/dashboard')).json()
    const tile = (label) => page.locator('.kpi', { hasText: label }).locator('.v')
    await expect(tile('Headcount')).toHaveText(String(kpis.total))
    await expect(tile('Active')).toHaveText(String(kpis.active))
    await expect(tile('On probation')).toHaveText(String(kpis.probation))
    await expect(tile('Onboarding')).toHaveText(String(kpis.onboarding))
    expect(kpis.total).toBeGreaterThanOrEqual(2)
    await expect(page.getByRole('heading', { name: 'Headcount by department' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pending actions' })).toBeVisible()
  })

  test('a KPI tile links to the filtered employee list (DASH-07)', async ({ page, provision, signedIn }) => {
    await signedIn(await provision('hr_admin'))
    await page.locator('.kpi', { hasText: 'On probation' }).click()
    await expect(page).toHaveURL(/\/employees\?status=probation/)
    await expect(page.getByLabel('Status')).toHaveValue('probation')
  })

  test('employees get no HR KPIs; managers see their team', async ({ page, provision, signedIn }) => {
    const boss = await provision('manager')
    const report = await provision('employee', { manager_id: boss.id })
    const plain = await provision('employee')

    await signedIn(plain)
    await expect(page.locator('.kpi')).toHaveCount(0)
    await expect(page.getByText('My team')).toHaveCount(0)

    await page.getByRole('button', { name: 'Sign out' }).click()
    await loginUI(page, boss)
    await expect(page.getByRole('heading', { name: 'My team (1)' })).toBeVisible()
    await expect(page.locator('tr', { hasText: report.last_name })).toBeVisible()
  })

  test('Super Admin signs in with the changed password (setup flow)', async ({ page, admin }) => {
    void admin // fixture guarantees the seed password was already changed
    await loginUI(page, { email: ADMIN.email }, ADMIN.password)
    await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible()
    await expect(page.locator('.topbar .badge')).toHaveText('super admin')
  })
})
