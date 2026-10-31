import { test, expect, navLink } from './helpers.js'

test.describe('navigation and route guards per role (AUTH-05)', () => {
  test('employee sees self-service only and is denied HR pages', async ({ page, provision, signedIn }) => {
    await signedIn(await provision('employee'))
    await expect(navLink(page, 'Dashboard')).toBeVisible()
    await expect(navLink(page, 'My profile')).toBeVisible()
    await expect(navLink(page, 'Org chart')).toBeVisible()
    for (const hidden of ['Employees', 'Add employee', 'Departments', 'Users & roles', 'Audit log']) {
      await expect(navLink(page, hidden)).toHaveCount(0)
    }
    for (const url of ['/employees', '/employees/new', '/org/departments', '/admin/users', '/admin/audit']) {
      await page.goto(url)
      await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
    }
  })

  test('manager sees the team list but cannot add employees or administer', async ({ page, provision, signedIn }) => {
    await signedIn(await provision('manager'))
    await expect(navLink(page, 'Employees')).toBeVisible()
    for (const hidden of ['Add employee', 'Bulk import', 'Departments', 'Users & roles']) {
      await expect(navLink(page, hidden)).toHaveCount(0)
    }
    await page.goto('/employees/new')
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
    await page.goto('/employees')
    await expect(page.getByRole('heading', { name: 'Employees', exact: true })).toBeVisible()
  })

  test('HR admin sees the full admin menu', async ({ page, provision, signedIn }) => {
    await signedIn(await provision('hr_admin'))
    for (const name of ['Employees', 'Add employee', 'Bulk import', 'Org chart', 'Departments', 'Designations', 'Locations', 'Holidays & settings', 'Users & roles', 'Audit log']) {
      await expect(navLink(page, name)).toBeVisible()
    }
    await expect(page.locator('.topbar .badge')).toHaveText('hr admin')
  })
})

test.describe('server-enforced scope (AUTH-06, EMP-06)', () => {
  test('employees only see themselves; HR endpoints are closed to them', async ({ provision, apiAs }) => {
    const me = await provision('employee')
    const other = await provision('employee')
    const api = await apiAs(me)

    const list = await (await api.get('/api/employees')).json()
    expect(list.items.map((e) => e.id)).toEqual([me.id])
    expect((await api.get(`/api/employees/${other.id}`)).status()).toBe(403)
    expect((await api.get(`/api/employees/${other.id}/history`)).status()).toBe(403)
    for (const url of ['/api/users', '/api/audit-log', '/api/employees/export', '/api/employees/options']) {
      expect((await api.get(url)).status(), url).toBe(403)
    }
    expect((await api.post('/api/employees', { data: {} })).status()).toBe(403)
  })

  test('managers see their team (direct and indirect) and nobody else, without salary', async ({ provision, apiAs }) => {
    const boss = await provision('manager')
    const lead = await provision('manager', { manager_id: boss.id })
    const report = await provision('employee', { manager_id: lead.id, salary: 61000 })
    const stranger = await provision('employee')
    const api = await apiAs(boss)

    const ids = (await (await api.get('/api/employees')).json()).items.map((e) => e.id)
    expect(ids).toEqual(expect.arrayContaining([boss.id, lead.id, report.id]))
    expect(ids).not.toContain(stranger.id)

    expect((await api.get(`/api/employees/${stranger.id}`)).status()).toBe(403)
    const seen = await (await api.get(`/api/employees/${report.id}`)).json()
    expect(seen.first_name).toBe('E2E')
    expect(seen).not.toHaveProperty('salary')
    expect(seen).not.toHaveProperty('national_id')
    // documents are HR/self only, even for the manager
    expect((await api.get(`/api/employees/${report.id}/documents`)).status()).toBe(403)
  })

  test('the employee and HR do see sensitive fields', async ({ provision, apiAs, admin }) => {
    const emp = await provision('employee', { salary: 70000, national_id: 'NID-VISIBLE' })
    const own = await (await (await apiAs(emp)).get(`/api/employees/${emp.id}`)).json()
    expect(Number(own.salary)).toBe(70000)
    expect(own.national_id).toBe('NID-VISIBLE')
    const asHr = await (await admin.get(`/api/employees/${emp.id}`)).json()
    expect(Number(asHr.salary)).toBe(70000)
  })

  test('UI: manager does not see salary on a report profile', async ({ page, provision, signedIn }) => {
    const boss = await provision('manager')
    const report = await provision('employee', { manager_id: boss.id, salary: 64000 })
    await signedIn(boss)
    await page.goto(`/employees/${report.id}`)
    await expect(page.getByRole('heading', { name: new RegExp(report.name) })).toBeVisible()
    await page.getByRole('button', { name: 'Job', exact: true }).click()
    await expect(page.getByText('Probation ends')).toBeVisible()
    await expect(page.getByText('Salary', { exact: true })).toHaveCount(0)
  })

  test('UI: HR sees salary on the Job tab', async ({ page, provision, signedIn }) => {
    const hr = await provision('hr_admin')
    const emp = await provision('employee', { salary: 64000 })
    await signedIn(hr)
    await page.goto(`/employees/${emp.id}`)
    await page.getByRole('button', { name: 'Job', exact: true }).click()
    await expect(page.getByText('Salary', { exact: true })).toBeVisible()
    await expect(page.getByText('64000')).toBeVisible()
  })

  test('HR admin cannot mint admins; only a Super Admin can', async ({ provision, apiAs }) => {
    const hr = await provision('hr_admin')
    const api = await apiAs(hr)
    const res = await api.post('/api/employees', {
      data: { first_name: 'Nope', last_name: 'Admin', email: `nope-${Date.now()}@example.com`, join_date: '2024-01-01', role: 'hr_admin' },
    })
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toBe('You cannot assign that role')
  })
})
