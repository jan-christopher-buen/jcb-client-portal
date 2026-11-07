import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Opt-in browser tests: reuse an operator-supplied Playwright/Chromium install.
// No real accounts, credentials, services or database are used by these tests.
if (!process.env.JCB_PLAYWRIGHT_MODULE || !process.env.JCB_BROWSER_EXECUTABLE)
  throw new Error(
    'Set JCB_PLAYWRIGHT_MODULE and JCB_BROWSER_EXECUTABLE to your local Playwright module and Chromium executable.',
  )
const { chromium } = await import(
  pathToFileURL(process.env.JCB_PLAYWRIGHT_MODULE).href
)
const base = 'http://127.0.0.1:5199'
const path = '/organizations/org/projects/project/handover'
const otherPath = '/organizations/other/projects/other/handover'
const initial = (id, position) => ({
  id,
  position,
  title: 'Task ' + id,
  description: 'Server ' + id,
  required: true,
  clientVisible: true,
  revision: 0,
  completedAt: null,
  completer: null,
})
let browser, server
before(async () => {
  server = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      '--config',
      'apps/web/vite.config.ts',
      'apps/web',
      '--host',
      '127.0.0.1',
      '--port',
      '5199',
      '--strictPort',
    ],
    { stdio: 'ignore' },
  )
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(base)).ok) break
    } catch {
      /* Wait for local Vite. */
    }
    if (attempt >= 100) throw new Error('Local test UI did not start')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({
    executablePath: process.env.JCB_BROWSER_EXECUTABLE,
    headless: true,
  })
})
after(async () => {
  await browser?.close()
  server?.kill('SIGTERM')
})
async function fixture(role = 'OWNER') {
  const context = await browser.newContext(),
    page = await context.newPage()
  page.setDefaultTimeout(5000)
  const state = {
    items: [initial('A', 1), initial('B', 2)],
    project: 'IN_REVIEW',
    status: 200,
    editStatus: 409,
    writes: [],
    gate: null,
    role,
    ready: false,
  }
  if (role === 'CLIENT') state.items[1].clientVisible = false
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      method = route.request().method()
    let status = 200,
      body
    if (url.pathname === '/api/auth/me')
      body = {
        user: {
          id: 'owner',
          role: state.role,
          name: 'Fictional owner',
          email: 'owner@example.test',
        },
      }
    else if (url.pathname === '/api/auth/csrf') body = { token: 'a'.repeat(64) }
    else if (
      ['/api' + path, '/api' + otherPath].includes(url.pathname) &&
      method === 'GET'
    ) {
      if (url.pathname === '/api' + otherPath && state.otherGate)
        await state.otherGate
      if (state.gate) await state.gate
      status = state.status
      body =
        status === 200
          ? {
              project: { id: 'project', status: state.project, revision: 1 },
              items: structuredClone(
                (url.pathname === '/api' + otherPath
                  ? [initial('Z', 1)]
                  : state.items
                ).filter((row) => state.role === 'OWNER' || row.clientVisible),
              ),
              completions: [],
              events: [],
              ready: state.ready,
              blockers:
                url.pathname === '/api' + path
                  ? [
                      {
                        code: 'FICTIONAL_LINK',
                        path: otherPath,
                        message: 'Other fictional workspace',
                      },
                    ]
                  : [],
              hasMoreEvents: url.searchParams.get('page') !== '2',
            }
          : { error: { code: 'UNAVAILABLE', message: 'Handover unavailable.' } }
    } else {
      const input = route.request().postDataJSON()
      state.writes.push({ path: url.pathname, method, input })
      if (url.pathname.endsWith('/check')) {
        const id = url.pathname.split('/').at(-2),
          item = state.items.find((i) => i.id === id)
        item.revision++
        item.completedAt = input.completed ? '2026-11-07T00:00:00Z' : null
        body = { itemId: id }
      } else if (method === 'PATCH') {
        status = state.editStatus
        const item = state.items.find((i) => url.pathname.endsWith('/' + i.id))
        if (status === 200) {
          Object.assign(item, input, {
            revision: item.revision + 1,
            completedAt: null,
          })
          delete item.expectedRevision
          delete item.reason
        }
        body =
          status === 200
            ? { itemId: item.id }
            : {
                error: {
                  code: 'STALE_REVISION',
                  message: 'Task changed. Reload handover.',
                },
              }
      } else if (method === 'POST') {
        status = 201
        state.items.push({
          ...input,
          id: 'C',
          revision: 0,
          completedAt: null,
          completer: null,
        })
        body = { itemId: 'C' }
      }
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  await page.goto(base + path)
  const task = (id) =>
    page.locator('article').filter({ has: page.locator('#check-' + id) })
  if (role === 'OWNER') await task('A').waitFor()
  else
    await page
      .getByRole('heading', { name: '1. Task A', exact: true })
      .waitFor()
  const newForm = page.locator('form').filter({
    has: page.getByRole('heading', {
      name: 'New handover task',
      exact: true,
    }),
  })
  return { context, page, state, task, newForm }
}
async function dirty(f) {
  await f
    .task('A')
    .getByRole('button', { name: 'Edit checklist item', exact: true })
    .click()
  const edit = f.task('A').locator('form')
  for (const form of [edit, f.newForm]) {
    await form
      .getByLabel('Checklist title', { exact: true })
      .fill('Local title')
    await form
      .getByLabel('Checklist description', { exact: true })
      .fill('Local description')
    await form
      .getByLabel('Checklist display order', { exact: true })
      .fill(form === edit ? '4' : '5')
    await form.getByLabel('Required checklist item', { exact: true }).uncheck()
    await form.getByLabel('Visible to clients', { exact: true }).uncheck()
  }
  await edit
    .getByLabel('Checklist edit reason', { exact: true })
    .fill('Local edit reason')
  await f
    .task('A')
    .getByLabel('Task action reason', { exact: true })
    .fill('Local check reason')
}
async function retained(f) {
  const edit = f.task('A').locator('form')
  for (const [form, order] of [
    [edit, '4'],
    [f.newForm, '5'],
  ]) {
    assert.equal(
      await form.getByLabel('Checklist title', { exact: true }).inputValue(),
      'Local title',
    )
    assert.equal(
      await form
        .getByLabel('Checklist description', { exact: true })
        .inputValue(),
      'Local description',
    )
    assert.equal(
      await form
        .getByLabel('Checklist display order', { exact: true })
        .inputValue(),
      order,
    )
    assert.equal(
      await form
        .getByLabel('Required checklist item', { exact: true })
        .isChecked(),
      false,
    )
    assert.equal(
      await form.getByLabel('Visible to clients', { exact: true }).isChecked(),
      false,
    )
  }
  assert.equal(
    await edit
      .getByLabel('Checklist edit reason', { exact: true })
      .inputValue(),
    'Local edit reason',
  )
  assert.equal(
    await f
      .task('A')
      .getByLabel('Task action reason', { exact: true })
      .inputValue(),
    'Local check reason',
  )
}
async function stale(f) {
  await f
    .task('A')
    .getByRole('button', { name: 'Save checklist changes', exact: true })
    .click()
  await f
    .task('A')
    .getByRole('button', { name: 'Reload handover', exact: true })
    .waitFor()
}
async function reload(f, action) {
  const response = f.page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      new URL(r.url()).pathname === '/api' + path,
  )
  await action()
  await response
  await f.page
    .getByRole('status')
    .filter({ hasText: 'Loading handover' })
    .waitFor({ state: 'hidden' })
}

test('stale edit reload retains independent task and new-task input', async () => {
  const f = await fixture()
  try {
    await dirty(f)
    await stale(f)
    await reload(f, () =>
      f
        .task('A')
        .getByRole('button', { name: 'Reload handover', exact: true })
        .click(),
    )
    await retained(f)
  } finally {
    await f.context.close()
  }
})
test('successful sibling check preserves task A and new-task fields/reasons', async () => {
  const f = await fixture()
  try {
    await dirty(f)
    await f
      .task('B')
      .getByLabel('Task action reason', { exact: true })
      .fill('Check B')
    await reload(f, () =>
      f
        .task('B')
        .getByRole('button', { name: 'Mark task complete', exact: true })
        .click(),
    )
    await retained(f)
  } finally {
    await f.context.close()
  }
})

test('stale task edit requires latest-field comparison and intentional revision retry', async () => {
  const f = await fixture()
  try {
    await dirty(f)
    await stale(f)
    Object.assign(f.state.items[0], {
      revision: 2,
      title: 'New server title',
      description: 'New server description',
      required: true,
      clientVisible: true,
      position: 3,
    })
    await reload(f, () =>
      f
        .task('A')
        .locator('form')
        .getByRole('button', { name: 'Reload handover', exact: true })
        .click(),
    )
    await retained(f)
    const edit = f.task('A').locator('form'),
      review = edit.getByRole('region', {
        name: 'Review latest checklist task',
      })
    await review.getByText('Latest task revision: 2', { exact: true }).waitFor()
    await review
      .getByText('Latest title: New server title', { exact: true })
      .waitFor()
    await review
      .getByText('Latest description: New server description', { exact: true })
      .waitFor()
    await review
      .getByText(
        'Required: true · Client-visible: true · Order: 3 · Incomplete',
        { exact: true },
      )
      .waitFor()
    assert.equal(
      await edit
        .getByRole('button', { name: 'Save checklist changes', exact: true })
        .isDisabled(),
      true,
    )
    assert.equal(f.state.writes.length, 1)
    await edit
      .getByRole('button', {
        name: 'Keep checklist edits against revision 2',
        exact: true,
      })
      .click()
    f.state.editStatus = 200
    await reload(f, () =>
      edit
        .getByRole('button', { name: 'Save checklist changes', exact: true })
        .click(),
    )
    assert.deepEqual(f.state.writes[1].input, {
      title: 'Local title',
      description: 'Local description',
      position: 4,
      required: false,
      clientVisible: false,
      expectedRevision: 2,
      reason: 'Local edit reason',
    })
    assert.equal(
      await edit
        .getByLabel('Checklist edit reason', { exact: true })
        .inputValue(),
      '',
    )
    assert.equal(
      await edit.getByLabel('Checklist title', { exact: true }).inputValue(),
      'Local title',
    )
    assert.equal(
      await f
        .task('A')
        .getByLabel('Task action reason', { exact: true })
        .inputValue(),
      'Local check reason',
    )
    assert.equal(
      await f.newForm
        .getByLabel('Checklist title', { exact: true })
        .inputValue(),
      'Local title',
    )
  } finally {
    await f.context.close()
  }
})

test('sibling check resets only its reason and preserves even its own dirty editor', async () => {
  const f = await fixture()
  try {
    await dirty(f)
    await f
      .task('B')
      .getByRole('button', { name: 'Edit checklist item', exact: true })
      .click()
    await f
      .task('B')
      .locator('form')
      .getByLabel('Checklist title', { exact: true })
      .fill('Dirty B title')
    await f
      .task('B')
      .locator('form')
      .getByLabel('Checklist edit reason', { exact: true })
      .fill('Dirty B edit reason')
    await f
      .task('B')
      .getByLabel('Task action reason', { exact: true })
      .fill('Check B')
    await reload(f, () =>
      f
        .task('B')
        .getByRole('button', { name: 'Mark task complete', exact: true })
        .click(),
    )
    await retained(f)
    assert.equal(
      await f
        .task('B')
        .getByLabel('Task action reason', { exact: true })
        .inputValue(),
      '',
    )
    assert.equal(
      await f
        .task('B')
        .locator('form')
        .getByLabel('Checklist title', { exact: true })
        .inputValue(),
      'Dirty B title',
    )
    assert.equal(
      await f
        .task('B')
        .locator('form')
        .getByLabel('Checklist edit reason', { exact: true })
        .inputValue(),
      'Dirty B edit reason',
    )
  } finally {
    await f.context.close()
  }
})

test('activity pagination keeps all fields/reasons and blocks writes during the fetch', async () => {
  const f = await fixture()
  try {
    await dirty(f)
    let release
    f.state.gate = new Promise((resolve) => {
      release = resolve
    })
    await f.page
      .getByRole('button', { name: 'Next handover activity', exact: true })
      .click()
    try {
      await retained(f)
      assert.equal(
        await f
          .task('A')
          .getByRole('button', { name: 'Save checklist changes', exact: true })
          .isDisabled(),
        true,
      )
      assert.equal(
        await f.newForm
          .getByRole('button', { name: 'Create handover task', exact: true })
          .isDisabled(),
        true,
      )
    } finally {
      release()
    }
    await f.page.getByText('Page 2', { exact: true }).waitFor()
    await f.page
      .getByRole('status')
      .filter({ hasText: 'Loading handover' })
      .waitFor({ state: 'hidden' })
    await retained(f)
    f.state.gate = null
    await reload(f, () =>
      f.page
        .getByRole('button', {
          name: 'Previous handover activity',
          exact: true,
        })
        .click(),
    )
    await retained(f)
  } finally {
    await f.context.close()
  }
})

for (const status of [503, 404])
  test(`failed refresh (${status}) preserves inputs and blocks unverified writes`, async () => {
    const f = await fixture()
    try {
      await dirty(f)
      await stale(f)
      f.state.status = status
      await reload(f, () =>
        f
          .task('A')
          .locator('form')
          .getByRole('button', { name: 'Reload handover', exact: true })
          .click(),
      )
      await retained(f)
      for (const button of [
        f
          .task('A')
          .getByRole('button', { name: 'Save checklist changes', exact: true }),
        f
          .task('A')
          .getByRole('button', { name: 'Mark task complete', exact: true }),
        f.newForm.getByRole('button', {
          name: 'Create handover task',
          exact: true,
        }),
        f.page.getByRole('button', {
          name: 'Confirm project completion',
          exact: true,
        }),
      ])
        assert.equal(await button.isDisabled(), true)
      await f
        .task('A')
        .locator('form')
        .evaluate((form) =>
          form.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          ),
        )
      await f.newForm.evaluate((form) =>
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
      )
      await f.page.waitForTimeout(100)
      assert.equal(f.state.writes.length, 1)
      f.state.status = 200
      await reload(f, () =>
        f.page
          .getByRole('button', { name: 'Reload handover', exact: true })
          .first()
          .click(),
      )
      await retained(f)
    } finally {
      await f.context.close()
    }
  })

test('confirmed discard replaces only the chosen editor with observed latest fields', async () => {
  const f = await fixture()
  try {
    await dirty(f)
    await stale(f)
    Object.assign(f.state.items[0], {
      revision: 1,
      title: 'Latest A',
      description: 'Latest description',
      required: true,
      clientVisible: true,
      position: 3,
    })
    await reload(f, () =>
      f
        .task('A')
        .locator('form')
        .getByRole('button', { name: 'Reload handover', exact: true })
        .click(),
    )
    const edit = f.task('A').locator('form'),
      discard = edit.getByRole('button', {
        name: 'Discard checklist edits and use latest',
        exact: true,
      })
    f.page.once('dialog', (d) => d.dismiss())
    await discard.click()
    await retained(f)
    f.page.once('dialog', (d) => d.accept())
    await discard.click()
    for (const [name, value] of [
      ['Checklist title', 'Latest A'],
      ['Checklist description', 'Latest description'],
      ['Checklist display order', '3'],
      ['Checklist edit reason', ''],
    ])
      assert.equal(
        await edit.getByLabel(name, { exact: true }).inputValue(),
        value,
      )
    assert.equal(
      await edit
        .getByLabel('Required checklist item', { exact: true })
        .isChecked(),
      true,
    )
    assert.equal(
      await edit.getByLabel('Visible to clients', { exact: true }).isChecked(),
      true,
    )
    assert.equal(
      await f
        .task('A')
        .getByLabel('Task action reason', { exact: true })
        .inputValue(),
      'Local check reason',
    )
    assert.equal(
      await f.newForm
        .getByLabel('Checklist title', { exact: true })
        .inputValue(),
      'Local title',
    )
    assert.equal(f.state.writes.length, 1)
  } finally {
    await f.context.close()
  }
})

test('successful creation resets only the submitted new-task form', async () => {
  const f = await fixture()
  try {
    await dirty(f)
    await reload(f, () =>
      f.newForm
        .getByRole('button', { name: 'Create handover task', exact: true })
        .click(),
    )
    assert.equal(
      await f.newForm
        .getByLabel('Checklist title', { exact: true })
        .inputValue(),
      '',
    )
    assert.equal(
      await f.newForm
        .getByLabel('Checklist description', { exact: true })
        .inputValue(),
      '',
    )
    assert.equal(
      await f.newForm
        .getByLabel('Checklist display order', { exact: true })
        .inputValue(),
      '3',
    )
    assert.equal(
      await f.newForm
        .getByLabel('Required checklist item', { exact: true })
        .isChecked(),
      true,
    )
    assert.equal(
      await f.newForm
        .getByLabel('Visible to clients', { exact: true })
        .isChecked(),
      true,
    )
    assert.equal(
      await f
        .task('A')
        .locator('form')
        .getByLabel('Checklist title', { exact: true })
        .inputValue(),
      'Local title',
    )
    assert.equal(
      await f
        .task('A')
        .locator('form')
        .getByLabel('Checklist edit reason', { exact: true })
        .inputValue(),
      'Local edit reason',
    )
    assert.equal(
      await f
        .task('A')
        .getByLabel('Task action reason', { exact: true })
        .inputValue(),
      'Local check reason',
    )
  } finally {
    await f.context.close()
  }
})

for (const project of ['ON_HOLD', 'CANCELLED', 'COMPLETED'])
  test(`${project} retains drafts and reasons while rejecting workflow writes`, async () => {
    const f = await fixture()
    try {
      await dirty(f)
      await stale(f)
      f.state.project = project
      await reload(f, () =>
        f
          .task('A')
          .locator('form')
          .getByRole('button', { name: 'Reload handover', exact: true })
          .click(),
      )
      await retained(f)
      await f
        .task('A')
        .getByRole('alert')
        .filter({ hasText: 'This project is' })
        .first()
        .waitFor()
      for (const button of [
        f
          .task('A')
          .getByRole('button', { name: 'Save checklist changes', exact: true }),
        f
          .task('A')
          .getByRole('button', { name: 'Mark task complete', exact: true }),
        f.newForm.getByRole('button', {
          name: 'Create handover task',
          exact: true,
        }),
      ])
        assert.equal(await button.isDisabled(), true)
      await f.newForm.evaluate((form) =>
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
      )
      await f.page.waitForTimeout(100)
      assert.equal(f.state.writes.length, 1)
    } finally {
      await f.context.close()
    }
  })

test('check/uncheck intent requires explicit latest-state review without clearing dirty editors', async () => {
  const f = await fixture()
  try {
    await dirty(f)
    await stale(f)
    Object.assign(f.state.items[0], {
      revision: 3,
      completedAt: '2026-11-07T00:00:00Z',
    })
    await reload(f, () =>
      f
        .task('A')
        .locator('form')
        .getByRole('button', { name: 'Reload handover', exact: true })
        .click(),
    )
    const action = f
      .task('A')
      .getByRole('button', { name: 'Uncheck task', exact: true })
    assert.equal(await action.isDisabled(), true)
    await f
      .task('A')
      .getByRole('button', {
        name: 'Use latest task state for check action',
        exact: true,
      })
      .click()
    await reload(f, () => action.click())
    assert.deepEqual(f.state.writes[1].input, {
      completed: false,
      expectedRevision: 3,
      reason: 'Local check reason',
    })
    assert.equal(
      await f
        .task('A')
        .getByLabel('Task action reason', { exact: true })
        .inputValue(),
      '',
    )
    assert.equal(
      await f
        .task('A')
        .locator('form')
        .getByLabel('Checklist edit reason', { exact: true })
        .inputValue(),
      'Local edit reason',
    )
    assert.equal(
      await f.newForm
        .getByLabel('Checklist title', { exact: true })
        .inputValue(),
      'Local title',
    )
  } finally {
    await f.context.close()
  }
})

test('closing a dirty task editor requires confirmed discard and leaves other input alone', async () => {
  const f = await fixture()
  try {
    await dirty(f)
    const edit = f.task('A').locator('form'),
      close = edit.getByRole('button', {
        name: 'Close task editor',
        exact: true,
      })
    f.page.once('dialog', (d) => d.dismiss())
    await close.click()
    await retained(f)
    f.page.once('dialog', (d) => d.accept())
    await close.click()
    assert.equal(await edit.isVisible(), false)
    await f
      .task('A')
      .getByRole('button', { name: 'Edit checklist item', exact: true })
      .click()
    assert.equal(
      await edit.getByLabel('Checklist title', { exact: true }).inputValue(),
      'Task A',
    )
    assert.equal(
      await edit
        .getByLabel('Checklist edit reason', { exact: true })
        .inputValue(),
      '',
    )
    assert.equal(
      await f
        .task('A')
        .getByLabel('Task action reason', { exact: true })
        .inputValue(),
      'Local check reason',
    )
    assert.equal(
      await f.newForm
        .getByLabel('Checklist title', { exact: true })
        .inputValue(),
      'Local title',
    )
  } finally {
    await f.context.close()
  }
})

test('a retained ready snapshot cannot authorize completion after a failed refresh', async () => {
  const f = await fixture()
  try {
    await dirty(f)
    f.state.ready = true
    await reload(f, () =>
      f.page
        .getByRole('button', { name: 'Next handover activity', exact: true })
        .click(),
    )
    const complete = f.page.getByRole('button', {
      name: 'Confirm project completion',
      exact: true,
    })
    assert.equal(await complete.isEnabled(), true)
    f.state.status = 503
    await reload(f, () =>
      f.page
        .getByRole('button', {
          name: 'Previous handover activity',
          exact: true,
        })
        .click(),
    )
    assert.equal(await complete.isDisabled(), true)
    await retained(f)
  } finally {
    await f.context.close()
  }
})

test('client checklist remains read-only and shows only the public response', async () => {
  const f = await fixture('CLIENT')
  try {
    assert.equal(await f.page.locator('form').count(), 0)
    assert.equal(
      await f.page
        .getByRole('button', { name: 'Edit checklist item', exact: true })
        .count(),
      0,
    )
    assert.equal(
      await f.page
        .getByRole('button', {
          name: 'Confirm project completion',
          exact: true,
        })
        .count(),
      0,
    )
    assert.equal(await f.page.getByText('Task B', { exact: false }).count(), 0)
    assert.equal(f.state.writes.length, 0)
  } finally {
    await f.context.close()
  }
})

test('duplicate task submits send one request and reset only that submitted edit', async () => {
  const f = await fixture()
  try {
    await dirty(f)
    let release, received
    const ready = new Promise((resolve) => {
        received = resolve
      }),
      gate = new Promise((resolve) => {
        release = resolve
      })
    await f.context.route('**/api' + path + '/items/A', async (route) => {
      const input = route.request().postDataJSON()
      f.state.writes.push({ input })
      received()
      await gate
      Object.assign(f.state.items[0], input, { revision: 1 })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ itemId: 'A' }),
      })
    })
    const edit = f.task('A').locator('form')
    await edit.evaluate((form) => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    })
    try {
      await ready
      assert.equal(f.state.writes.length, 1)
      assert.equal(
        await edit
          .getByRole('button', { name: 'Saving…', exact: true })
          .isDisabled(),
        true,
      )
    } finally {
      release()
    }
    await f.page
      .getByRole('status')
      .filter({ hasText: 'Loading handover' })
      .waitFor({ state: 'hidden' })
    await edit
      .getByRole('button', { name: 'Save checklist changes', exact: true })
      .waitFor()
    assert.equal(
      await edit
        .getByLabel('Checklist edit reason', { exact: true })
        .inputValue(),
      '',
    )
    assert.equal(
      await f.newForm
        .getByLabel('Checklist title', { exact: true })
        .inputValue(),
      'Local title',
    )
    assert.equal(f.state.writes.length, 1)
  } finally {
    await f.context.close()
  }
})

test('pagination retention never carries task data or drafts into another organization/project', async () => {
  const f = await fixture()
  try {
    await dirty(f)
    let release
    f.state.otherGate = new Promise((resolve) => {
      release = resolve
    })
    await f.page
      .getByRole('link', { name: 'Other fictional workspace', exact: true })
      .click()
    try {
      await f.page.waitForURL('**/organizations/other/projects/other/handover')
      assert.equal(
        await f.page.getByLabel('Checklist title', { exact: true }).count(),
        0,
      )
    } finally {
      release()
    }
    await f.task('Z').waitFor()
    assert.equal(await f.task('A').count(), 0)
    assert.equal(
      await f.newForm
        .getByLabel('Checklist title', { exact: true })
        .inputValue(),
      '',
    )
  } finally {
    await f.context.close()
  }
})
