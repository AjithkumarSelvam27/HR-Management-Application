import { test, expect, uid, today } from './helpers.js'

const mkDept = async (api, extra = {}) => {
  const id = uid()
  const body = { name: `E2E Dept ${id}`, code: `D${id}`, active: true, ...extra }
  const res = await api.post('/api/departments', { data: body })
  expect(res.ok(), await res.text()).toBeTruthy()
  return { ...body, id: (await res.json()).id }
}

test.describe('departments / designations / locations UI (ORG-01..04)', () => {
  test('HR creates a department and sees it in the table and the employee form', async ({ page, provision, signedIn }) => {
    const hr = await provision('hr_admin')
    await signedIn(hr)
    const id = uid()
    await page.goto('/org/departments')
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByLabel('Name', { exact: true }).fill(`UI Dept ${id}`)
    await page.getByLabel('Code', { exact: true }).fill(`U${id}`)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('tbody tr', { hasText: `UI Dept ${id}` })).toContainText(`U${id}`)

    await page.goto('/employees/new')
    await page.getByRole('button', { name: '2. Job' }).click()
    await expect(page.getByLabel('Department').locator('option', { hasText: `UI Dept ${id}` })).toHaveCount(1)
  })

  test('duplicate department name or code is rejected (ORG-04)', async ({ page, provision, signedIn, admin }) => {
    const hr = await provision('hr_admin')
    const existing = await mkDept(admin)
    await signedIn(hr)
    await page.goto('/org/departments')
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByLabel('Name', { exact: true }).fill(existing.name)
    await page.getByLabel('Code', { exact: true }).fill(`X${uid()}`)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('.error')).toHaveText('A record with that name or code already exists')
  })

  test('HR can edit and deactivate a location; designations can be created', async ({ page, provision, signedIn }) => {
    const hr = await provision('hr_admin')
    await signedIn(hr)
    const id = uid()

    await page.goto('/org/locations')
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByLabel('Name', { exact: true }).fill(`Site ${id}`)
    await page.getByLabel('Country').fill('Japan')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const row = page.locator('tbody tr', { hasText: `Site ${id}` })
    await expect(row).toContainText('Japan')
    await row.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Status').selectOption({ label: 'Inactive' })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(row.locator('.badge')).toHaveText('inactive')

    await page.goto('/org/designations')
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByLabel('Title').fill(`Title ${id}`)
    await page.getByLabel('Grade / level').fill('Z9')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('tbody tr', { hasText: `Title ${id}` })).toContainText('Z9')
  })

  test('non-HR users cannot change org data through the API', async ({ provision, apiAs }) => {
    const api = await apiAs(await provision('manager'))
    expect((await api.post('/api/departments', { data: { name: 'x', code: 'x' } })).status()).toBe(403)
    expect((await api.post('/api/locations', { data: { name: 'x' } })).status()).toBe(403)
    expect((await api.get('/api/departments')).ok()).toBeTruthy() // but they can read them
  })
})

test.describe('hierarchy and integrity rules (ORG-04, ORG-05)', () => {
  test('circular and self-parent departments are blocked', async ({ admin }) => {
    const a = await mkDept(admin)
    const b = await mkDept(admin, { parent_id: a.id })
    const loop = await admin.put(`/api/departments/${a.id}`, { data: { name: a.name, code: a.code, active: true, parent_id: b.id } })
    expect(loop.status()).toBe(422)
    expect((await loop.json()).error).toBe('That parent would create a circular hierarchy')
    const self = await admin.put(`/api/departments/${a.id}`, { data: { name: a.name, code: a.code, active: true, parent_id: a.id } })
    expect(self.status()).toBe(422)
    expect((await self.json()).error).toBe('A department cannot be its own parent')
  })

  test('a department with active employees cannot be deactivated until they are reassigned', async ({ provision, admin }) => {
    const from = await mkDept(admin)
    const to = await mkDept(admin)
    const emp = await provision('employee', { department_id: from.id })
    const off = { data: { name: from.name, code: from.code, active: false } }

    const blocked = await admin.put(`/api/departments/${from.id}`, off)
    expect(blocked.status()).toBe(409)
    expect((await blocked.json()).error).toContain('1 active employee(s) are in this department')

    const moved = await admin.post(`/api/departments/${from.id}/reassign`, { data: { target_department_id: to.id } })
    expect(moved.ok(), await moved.text()).toBeTruthy()
    expect((await (await admin.get(`/api/employees/${emp.id}`)).json()).department).toBe(to.name)
    expect((await admin.put(`/api/departments/${from.id}`, off)).ok()).toBeTruthy()
    expect((await admin.post(`/api/departments/${from.id}/reassign`, { data: { target_department_id: from.id } })).status()).toBe(422)
  })

  test('employee form rejects unknown references', async ({ admin }) => {
    const res = await admin.post('/api/employees', {
      data: { first_name: 'Bad', last_name: 'Ref', email: `bad-${uid()}@example.com`, join_date: today(), department_id: 999999 },
    })
    expect(res.status()).toBe(422)
  })
})

test.describe('company settings and holidays (ORG-07)', () => {
  test('HR saves probation length and it persists', async ({ page, provision, signedIn }) => {
    await signedIn(await provision('hr_admin'))
    await page.goto('/org/settings')
    await page.getByLabel('Probation length (months)').fill('6')
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.locator('.success')).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Probation length (months)')).toHaveValue('6')
    // restore the seed default so the suite is order-independent
    await page.getByLabel('Probation length (months)').fill('3')
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.locator('.success')).toBeVisible()
  })

  test('HR adds and removes a holiday', async ({ page, provision, signedIn }) => {
    await signedIn(await provision('hr_admin'))
    const name = `E2E Holiday ${uid()}`
    const date = today(2000 + Math.floor(Math.random() * 3000))
    await page.goto('/org/settings')
    await page.getByLabel('Name', { exact: true }).fill(name)
    await page.getByLabel('Date', { exact: true }).fill(date)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const row = page.locator('tr', { hasText: name })
    await expect(row).toContainText(date)
    await row.getByRole('button', { name: 'Remove' }).click()
    await expect(page.locator('tr', { hasText: name })).toHaveCount(0)
  })
})

test.describe('org chart (ORG-08)', () => {
  test('shows reporting lines and highlights search matches', async ({ page, provision, signedIn }) => {
    const hr = await provision('hr_admin')
    const boss = await provision('manager')
    const report = await provision('employee', { manager_id: boss.id })
    await signedIn(hr)
    await page.goto('/org/chart')
    await expect(page.getByRole('heading', { name: 'Org chart' })).toBeVisible()
    const bossNode = page.locator('li', { hasText: boss.name }).first()
    await expect(bossNode).toBeVisible()
    await expect(bossNode.getByRole('link', { name: report.name })).toBeVisible()

    await page.getByLabel('Search').fill(report.last_name)
    await expect(page.locator('.node', { hasText: report.name })).toHaveCSS('background-color', 'rgb(255, 244, 194)')
  })
})
