import { test, expect, loginUI, signOutUI, uid, today, PASSWORD, PNG_BYTES, PDF_BYTES } from './helpers.js'

async function deptByCode(api, code) {
  const rows = await (await api.get('/api/departments')).json()
  return rows.find((d) => d.code === code)
}

async function createDepartment(api, label = 'Dept') {
  const id = uid()
  const res = await api.post('/api/departments', { data: { name: `E2E ${label} ${id}`, code: `E${id}`.slice(0, 20), active: true } })
  expect(res.ok()).toBeTruthy()
  return { id: (await res.json()).id, name: `E2E ${label} ${id}` }
}

test.describe('create employee through the UI (EMP-01..03)', () => {
  test('HR creates an employee; the new hire can sign in and is forced to change the temp password', async ({ page, provision, signedIn, admin }) => {
    const hr = await provision('hr_admin')
    await signedIn(hr)
    const id = uid()
    const email = `e2e-new-${id}@example.com`
    const eng = await deptByCode(admin, 'ENG')

    await page.goto('/employees/new')
    await page.getByLabel('First name').fill('Nina')
    await page.getByLabel('Last name').fill(`Newhire${id}`)
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByLabel('Department').selectOption({ label: eng.name })
    await page.getByLabel('Salary (annual)').fill('72000')
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByLabel('Work email').fill(email)
    await page.getByRole('button', { name: 'Create employee' }).click()

    const ok = page.locator('.success')
    await expect(ok).toContainText(/EMP\d{4}/)
    const temp = (await ok.locator('code').textContent()).trim()
    expect(temp.length).toBeGreaterThan(8)

    // the record exists with what we typed (checked through the API, not the form)
    const found = await (await admin.get('/api/employees', { params: { q: email } })).json()
    expect(found.total).toBe(1)
    expect(found.items[0]).toMatchObject({ first_name: 'Nina', last_name: `Newhire${id}`, email, department: eng.name })
    expect(Number(found.items[0].salary)).toBe(72000)

    // profile is reachable from the success banner
    await page.getByRole('link', { name: 'Open profile' }).click()
    await expect(page.getByRole('heading', { name: new RegExp(`Nina Newhire${id}`) })).toBeVisible()

    // new hire signs in with the temp password and must change it
    await signOutUI(page)
    await loginUI(page, { email }, temp)
    await expect(page).toHaveURL(/\/change-password/)
  })

  test('required fields and duplicate emails are rejected with clear messages (EMP-02)', async ({ page, provision, signedIn }) => {
    const hr = await provision('hr_admin')
    const existing = await provision('employee')
    await signedIn(hr)
    await page.goto('/employees/new')

    await page.getByRole('button', { name: '3. Account' }).click()
    await page.getByLabel('Work email').fill(`e2e-x-${uid()}@example.com`)
    await page.getByRole('button', { name: 'Create employee' }).click()
    await expect(page.locator('.error')).toHaveText('First and last name are required')

    await page.getByRole('button', { name: '1. Personal' }).click()
    await page.getByLabel('First name').fill('Dup')
    await page.getByLabel('Last name').fill('Licate')
    await page.getByRole('button', { name: '3. Account' }).click()
    await page.getByLabel('Work email').fill(existing.email)
    await page.getByRole('button', { name: 'Create employee' }).click()
    await expect(page.locator('.error')).toContainText('already exists')
  })
})

test.describe('employee list (EMP-04)', () => {
  test('search narrows to the matching person and reports empty results', async ({ page, provision, signedIn }) => {
    const hr = await provision('hr_admin')
    const target = await provision('employee')
    await provision('employee') // a decoy that must not match
    await signedIn(hr)
    await page.goto('/employees')
    await page.getByLabel('Search').fill(target.last_name)
    await page.getByLabel('Search').press('Enter')
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.locator('tbody tr')).toContainText(target.email)

    await page.getByLabel('Search').fill(`zz-no-such-${uid()}`)
    await page.getByLabel('Search').press('Enter')
    await expect(page.getByText('No employees match.')).toBeVisible()
  })

  test('department filter only lists people in that department', async ({ page, provision, signedIn, admin }) => {
    const hr = await provision('hr_admin')
    const dept = await createDepartment(admin, 'Filter')
    const inDept = await provision('employee', { department_id: dept.id })
    await provision('employee') // different (no) department
    await signedIn(hr)
    await page.goto('/employees')
    await page.getByLabel('Department').selectOption({ label: dept.name })
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.locator('tbody tr')).toContainText(inDept.email)
  })

  test('clicking a row opens the profile', async ({ page, provision, signedIn }) => {
    const hr = await provision('hr_admin')
    const emp = await provision('employee')
    await signedIn(hr)
    await page.goto('/employees')
    await page.getByLabel('Search').fill(emp.email)
    await page.getByLabel('Search').press('Enter')
    await page.locator('tbody tr', { hasText: emp.email }).click()
    await expect(page).toHaveURL(new RegExp(`/employees/${emp.id}$`))
    await expect(page.getByRole('heading', { name: new RegExp(emp.name) })).toBeVisible()
  })
})

test.describe('job changes and history (EMP-09, EMP-10)', () => {
  test('HR records a change in the UI; it applies immediately and is audited in history', async ({ page, provision, signedIn, admin }) => {
    const hr = await provision('hr_admin')
    const emp = await provision('employee')
    const dept = await createDepartment(admin, 'Transfer')
    await signedIn(hr)
    await page.goto(`/employees/${emp.id}`)
    await page.getByRole('button', { name: 'Job', exact: true }).click()
    await page.getByLabel('Change type').selectOption('transfer')
    await page.getByLabel('Effective date').fill(today())
    await page.getByLabel('Department').selectOption({ label: dept.name })
    await page.getByRole('button', { name: 'Record change' }).click()
    await expect(page.locator('.success')).toBeVisible()

    const after = await (await admin.get(`/api/employees/${emp.id}`)).json()
    expect(after.department).toBe(dept.name)
    const { history } = await (await admin.get(`/api/employees/${emp.id}/history`)).json()
    const row = history.find((h) => h.field === 'department_id')
    expect(row).toMatchObject({ change_type: 'transfer', new_value: String(dept.id) })
  })

  test('backdated changes need explicit confirmation', async ({ page, provision, signedIn, admin }) => {
    const hr = await provision('hr_admin')
    const emp = await provision('employee')
    const dept = await createDepartment(admin, 'Backdate')
    await signedIn(hr)
    await page.goto(`/employees/${emp.id}`)
    await page.getByRole('button', { name: 'Job', exact: true }).click()
    await page.getByLabel('Effective date').fill(today(-10))
    await page.getByLabel('Department').selectOption({ label: dept.name })
    await page.getByRole('button', { name: 'Record change' }).click()
    await expect(page.getByText('That date is in the past.')).toBeVisible()
    expect((await (await admin.get(`/api/employees/${emp.id}`)).json()).department).not.toBe(dept.name) // not applied yet

    await page.getByRole('button', { name: 'Confirm backdated change' }).click()
    await expect(page.locator('.success')).toBeVisible()
    expect((await (await admin.get(`/api/employees/${emp.id}`)).json()).department).toBe(dept.name)
  })

  test('future-dated changes stay pending until their effective date', async ({ provision, admin }) => {
    const emp = await provision('employee')
    const dept = await createDepartment(admin, 'Future')
    const res = await admin.post(`/api/employees/${emp.id}/job-change`, { data: { change_type: 'transfer', effective_date: today(30), department_id: dept.id } })
    expect((await res.json()).applied).toBe(false)
    expect((await (await admin.get(`/api/employees/${emp.id}`)).json()).department_id).not.toBe(dept.id)
    const { pending } = await (await admin.get(`/api/employees/${emp.id}/history`)).json()
    expect(pending).toHaveLength(1)
    expect(pending[0].changes.department_id).toBe(dept.id)
  })

  test('reporting loops and empty changes are rejected (ORG-09)', async ({ provision, admin }) => {
    const boss = await provision('manager')
    const report = await provision('employee', { manager_id: boss.id })
    const loop = await admin.post(`/api/employees/${boss.id}/job-change`, { data: { effective_date: today(), manager_id: report.id } })
    expect(loop.status()).toBe(422)
    expect((await loop.json()).error).toBe('That manager would create a reporting loop')
    const empty = await admin.post(`/api/employees/${boss.id}/job-change`, { data: { effective_date: today() } })
    expect(empty.status()).toBe(422)
  })
})

test.describe('self-service edits (EMP-07, EMP-08)', () => {
  test('employees may edit contact details but nothing else', async ({ provision, apiAs, admin }) => {
    const emp = await provision('employee')
    const api = await apiAs(emp)
    const ok = await api.patch(`/api/employees/${emp.id}`, { data: { phone: '555-0100', address: '1 Test Way' } })
    expect(ok.ok()).toBeTruthy()
    expect((await (await admin.get(`/api/employees/${emp.id}`)).json()).phone).toBe('555-0100')

    const bad = await api.patch(`/api/employees/${emp.id}`, { data: { salary: 999999 } })
    expect(bad.status()).toBe(403)
    expect((await bad.json()).error).toBe('You cannot edit: salary')
    expect(Number((await (await admin.get(`/api/employees/${emp.id}`)).json()).salary)).toBe(50000)
  })

  test('employees cannot edit someone else; HR cannot reuse an email', async ({ provision, apiAs, admin }) => {
    const a = await provision('employee')
    const b = await provision('employee')
    expect((await (await apiAs(a)).patch(`/api/employees/${b.id}`, { data: { phone: '1' } })).status()).toBe(403)
    const dup = await admin.patch(`/api/employees/${b.id}`, { data: { email: a.email } })
    expect(dup.status()).toBe(409)
    expect((await dup.json()).error).toBe('That email is already in use')
  })

  test('UI: employee edits their own phone from the profile', async ({ page, provision, signedIn }) => {
    const emp = await provision('employee')
    await signedIn(emp)
    await page.getByRole('link', { name: 'My profile', exact: true }).click()
    await expect(page.getByRole('heading', { name: new RegExp(emp.name) })).toBeVisible()
    await page.getByRole('button', { name: 'Personal', exact: true }).click()
    await page.getByLabel('Phone').fill('555-0199')
    await page.getByRole('button', { name: /^Save/ }).click()
    await expect(page.locator('.success')).toBeVisible()
    await page.reload()
    await page.getByRole('button', { name: 'Personal', exact: true }).click()
    await expect(page.getByLabel('Phone')).toHaveValue('555-0199')
  })
})

test.describe('offboarding (EMP-15..17)', () => {
  test('blocked while the employee still has direct reports, allowed once reassigned', async ({ provision, admin }) => {
    const boss = await provision('manager')
    const other = await provision('manager')
    const report = await provision('employee', { manager_id: boss.id })

    const blocked = await admin.post(`/api/employees/${boss.id}/offboarding`, { data: { last_working_day: today(30), reason: 'moving on' } })
    expect(blocked.status()).toBe(409)
    expect((await blocked.json()).error).toContain("Reassign this employee's 1 direct report(s) first")

    expect((await admin.post(`/api/employees/${report.id}/job-change`, { data: { effective_date: today(), manager_id: other.id } })).ok()).toBeTruthy()
    const started = await admin.post(`/api/employees/${boss.id}/offboarding`, { data: { last_working_day: today(30), reason: 'moving on' } })
    expect(started.ok()).toBeTruthy()
    expect((await started.json()).status).toBe('offboarding')

    const again = await admin.post(`/api/employees/${boss.id}/offboarding`, { data: { last_working_day: today(30), reason: 'again' } })
    expect(again.status()).toBe(409)
    const early = await admin.post(`/api/employees/${boss.id}/offboarding/complete`)
    expect(early.status()).toBe(409) // last working day has not arrived
  })

  test('UI: HR sees the offboarding state on the profile', async ({ page, provision, signedIn, admin }) => {
    const hr = await provision('hr_admin')
    const emp = await provision('employee')
    expect((await admin.post(`/api/employees/${emp.id}/offboarding`, { data: { last_working_day: today(14), reason: 'relocating' } })).ok()).toBeTruthy()
    await signedIn(hr)
    await page.goto(`/employees/${emp.id}`)
    await expect(page.locator('h1 .badge')).toHaveText('offboarding')
    await page.getByRole('button', { name: 'Job', exact: true }).click()
    await expect(page.locator('.card', { hasText: 'Offboarding' }).getByText('relocating')).toBeVisible()
  })
})

test.describe('documents (EMP-11)', () => {
  const upload = (api, id, name, buffer, mimeType, category = 'other') =>
    api.post(`/api/employees/${id}/documents`, { multipart: { category, file: { name, mimeType, buffer } } })

  test('accepts PDF/PNG, rejects wrong types and spoofed content', async ({ provision, apiAs }) => {
    const emp = await provision('employee')
    const api = await apiAs(emp)
    expect((await upload(api, emp.id, 'contract.pdf', PDF_BYTES, 'application/pdf', 'contract')).ok()).toBeTruthy()
    expect((await upload(api, emp.id, 'id.png', PNG_BYTES, 'image/png', 'id')).ok()).toBeTruthy()

    const exe = await upload(api, emp.id, 'evil.exe', Buffer.from('MZ'), 'application/octet-stream')
    expect(exe.status()).toBe(422)
    expect((await exe.json()).error).toBe('Only PDF, JPG and PNG files are allowed')
    const spoof = await upload(api, emp.id, 'fake.pdf', Buffer.from('not a pdf'), 'application/pdf')
    expect(spoof.status()).toBe(422)
    expect((await spoof.json()).error).toBe('File content does not match its extension')
    const cat = await upload(api, emp.id, 'x.pdf', PDF_BYTES, 'application/pdf', 'bogus')
    expect(cat.status()).toBe(422)

    const docs = await (await api.get(`/api/employees/${emp.id}/documents`)).json()
    expect(docs.map((d) => d.filename).sort()).toEqual(['contract.pdf', 'id.png'])
  })

  test('only the owner and HR can download; others get 403', async ({ provision, apiAs, admin }) => {
    const owner = await provision('employee')
    const other = await provision('employee')
    const doc = await (await upload(await apiAs(owner), owner.id, 'secret.pdf', PDF_BYTES, 'application/pdf')).json()

    const mine = await (await apiAs(owner)).get(`/api/employees/documents/${doc.id}/download`)
    expect(mine.ok()).toBeTruthy()
    expect((await mine.body()).subarray(0, 4).toString()).toBe('%PDF')
    expect((await admin.get(`/api/employees/documents/${doc.id}/download`)).ok()).toBeTruthy()
    expect((await (await apiAs(other)).get(`/api/employees/documents/${doc.id}/download`)).status()).toBe(403)
  })
})

test.describe('CSV import / export (EMP-13, EMP-14)', () => {
  test('HR export contains employees; non-HR cannot export', async ({ provision, admin, apiAs }) => {
    const emp = await provision('employee')
    const csv = await admin.get('/api/employees/export')
    expect(csv.ok()).toBeTruthy()
    expect(await csv.text()).toContain(emp.email)
    expect((await (await apiAs(emp)).get('/api/employees/export')).status()).toBe(403)
  })
})
