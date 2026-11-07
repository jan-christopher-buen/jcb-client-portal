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
const base = 'http://127.0.0.1:5198'
const project = '/organizations/org/projects/project'
const list = project + '/deliverables'
const detail = list + '/deliverable'
const editor = detail + '/versions/version/edit'
const initial = {
  id: 'version',
  number: 1,
  revision: 0,
  state: 'DRAFT',
  title: 'Server title',
  description: 'Server description',
  links: [
    { label: 'Remove server link', url: 'https://example.com/remove' },
    { label: 'Keep server link', url: 'https://example.com/keep' },
  ],
  publishedAt: null,
  publicationReason: '',
  decision: null,
}
const localLinks = [
  { label: 'Local kept link', url: 'https://example.com/local-kept' },
  { label: 'Local added link', url: 'https://example.com/local-added' },
]
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
      '5198',
      '--strictPort',
    ],
    { stdio: 'ignore' },
  )
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) break
    } catch {
      /* Wait for local Vite. */
    }
    if (attempt >= 100) throw new Error('Local test UI did not start')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({
    executablePath: process.env.JCB_BROWSER_EXECUTABLE,
    headless: true,
    timeout: 20000,
  })
})
after(async () => {
  try {
    await browser?.close()
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise((resolve) => server.once('exit', resolve))
      const forceKill = setTimeout(() => server.kill('SIGKILL'), 3000)
      server.kill('SIGTERM')
      try {
        await exited
      } finally {
        clearTimeout(forceKill)
      }
    }
  }
})
async function fixture(create = false) {
  const context = await browser.newContext(),
    page = await context.newPage()
  page.setDefaultTimeout(5000)
  const state = {
    version: structuredClone(initial),
    project: 'ACTIVE',
    status: 200,
    saveStatus: 409,
    writes: [],
    occupied: false,
    gate: null,
  }
  const record = () => ({
    id: 'deliverable',
    organizationId: 'org',
    projectId: 'project',
    required: true,
    position: 1,
    revision: 0,
    currentVersionId: null,
    acceptance: 'UNPUBLISHED',
    versions: state.version ? [structuredClone(state.version)] : [],
    events: [],
  })
  await context.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname,
      method = route.request().method()
    let status = 200,
      body
    if (pathname === '/api/auth/me')
      body = {
        user: {
          id: 'owner',
          name: 'Fictional owner',
          email: 'owner@example.test',
          role: 'OWNER',
        },
      }
    else if (pathname === '/api/auth/csrf') body = { token: 'a'.repeat(64) }
    else if (
      (pathname === '/api' + list || pathname === '/api' + detail) &&
      method === 'GET'
    ) {
      if (state.gate) await state.gate
      status = state.status
      body =
        status === 200
          ? pathname === '/api' + list
            ? {
                project: { id: 'project', status: state.project, revision: 0 },
                deliverables: state.occupied
                  ? [{ ...record(), position: 5 }]
                  : [],
              }
            : {
                project: { id: 'project', status: state.project, revision: 0 },
                deliverable: record(),
                hasMoreEvents: false,
                page: 1,
              }
          : {
              error: {
                code: 'NOT_FOUND',
                message: 'Deliverable state unavailable.',
              },
            }
    } else if (
      (pathname === '/api' + list && method === 'POST') ||
      (pathname === '/api' + detail + '/versions/version' && method === 'PATCH')
    ) {
      state.writes.push(route.request().postDataJSON())
      status = state.saveStatus
      body =
        status === 200 || status === 201
          ? { deliverableId: 'deliverable', versionId: 'version' }
          : {
              error: {
                code: 'CONFLICT',
                message: create
                  ? 'Display order is occupied.'
                  : 'Draft changed. Reload latest state.',
              },
            }
    } else {
      status = 503
      body = {
        error: {
          code: 'UNAVAILABLE',
          message: 'Unrelated fixture section unavailable.',
        },
      }
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  await page.goto(base + (create ? project : editor))
  const form = page
    .locator('form')
    .filter({ has: page.getByLabel('Deliverable title', { exact: true }) })
  await form.waitFor()
  return { context, page, form, state }
}
async function edit({ page, form }, create = false) {
  await form
    .getByLabel('Deliverable title', { exact: true })
    .fill('Local title')
  await form
    .getByLabel('Deliverable description', { exact: true })
    .fill('Local description')
  if (create) {
    await form.getByLabel('Required deliverable', { exact: true }).uncheck()
    await form
      .getByLabel('Deliverable display order', { exact: true })
      .fill('5')
    await form
      .getByRole('button', { name: 'Add external link', exact: true })
      .click()
  } else
    await form
      .getByRole('button', { name: 'Remove link 1', exact: true })
      .click()
  await form
    .getByRole('button', { name: 'Add external link', exact: true })
    .click()
  for (let i = 0; i < 2; i++) {
    await page
      .getByLabel(`Link ${i + 1} label`, { exact: true })
      .fill(localLinks[i].label)
    await page
      .getByLabel(`Link ${i + 1} HTTPS URL`, { exact: true })
      .fill(localLinks[i].url)
  }
}
async function fields({ page, form }, create = false) {
  assert.equal(
    await form.getByLabel('Deliverable title', { exact: true }).inputValue(),
    'Local title',
  )
  assert.equal(
    await form
      .getByLabel('Deliverable description', { exact: true })
      .inputValue(),
    'Local description',
  )
  assert.equal(
    await form.getByRole('button', { name: /Remove link/ }).count(),
    2,
  )
  for (let i = 0; i < 2; i++) {
    assert.equal(
      await page
        .getByLabel(`Link ${i + 1} label`, { exact: true })
        .inputValue(),
      localLinks[i].label,
    )
    assert.equal(
      await page
        .getByLabel(`Link ${i + 1} HTTPS URL`, { exact: true })
        .inputValue(),
      localLinks[i].url,
    )
  }
  if (create) {
    assert.equal(
      await form
        .getByLabel('Required deliverable', { exact: true })
        .isChecked(),
      false,
    )
    assert.equal(
      await form
        .getByLabel('Deliverable display order', { exact: true })
        .inputValue(),
      '5',
    )
  }
}
async function fail({ form }, create = false) {
  await form
    .getByRole('button', {
      name: create ? 'Create deliverable draft' : 'Save deliverable draft',
      exact: true,
    })
    .click()
  await form
    .getByRole('button', { name: 'Reload latest state', exact: true })
    .waitFor()
}
async function reload({ page, form }, create = false) {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      new URL(r.url()).pathname === '/api' + (create ? list : detail),
  )
  await form
    .getByRole('button', { name: 'Reload latest state', exact: true })
    .click()
  await response
  await page
    .getByRole('status')
    .filter({
      hasText: create ? 'Loading deliverables' : 'Loading deliverable editor',
    })
    .waitFor({ state: 'hidden' })
}
for (const create of [false, true])
  test(
    create
      ? 'failed creation at occupied order → reload retains every field'
      : 'stale update → reload retains title, description and added/removed links',
    async () => {
      const f = await fixture(create)
      try {
        await edit(f, create)
        await fail(f, create)
        f.state.occupied = true
        if (!create)
          f.state.version = {
            ...f.state.version,
            revision: 1,
            title: 'Newer server title',
          }
        await reload(f, create)
        await fields(f, create)
      } finally {
        await f.context.close()
      }
    },
  )

test('stale update requires full comparison and deliberate reconciliation before retry', async () => {
  const f = await fixture()
  try {
    await edit(f)
    await fail(f)
    f.state.version = {
      ...f.state.version,
      revision: 2,
      title: 'Latest server title',
      description: 'Latest server description',
      links: [
        { label: 'Latest server link', url: 'https://example.com/latest' },
      ],
    }
    await reload(f)
    await fields(f)
    const review = f.form.getByRole('region', {
      name: 'Review latest server deliverable',
    })
    await review
      .getByText('Latest server revision: 2', { exact: true })
      .waitFor()
    await review.getByText('Latest server title', { exact: true }).waitFor()
    await review
      .getByText('Latest server description', { exact: true })
      .waitFor()
    assert.equal(
      await review
        .getByRole('link', {
          name: 'Latest server link — external (new tab)',
          exact: true,
        })
        .getAttribute('href'),
      'https://example.com/latest',
    )
    assert.equal(
      await f.form
        .getByRole('button', { name: 'Save deliverable draft', exact: true })
        .isDisabled(),
      true,
    )
    assert.equal(f.state.writes.length, 1)
    await f.form
      .getByLabel('Deliverable title', { exact: true })
      .fill('Reconciled title')
    await f.form
      .getByRole('button', {
        name: 'Keep my edits against revision 2',
        exact: true,
      })
      .click()
    f.state.saveStatus = 200
    await f.form
      .getByRole('button', { name: 'Save deliverable draft', exact: true })
      .click()
    await f.page.waitForURL('**/deliverables/deliverable?version=version')
    assert.deepEqual(f.state.writes[1], {
      title: 'Reconciled title',
      description: 'Local description',
      links: localLinks,
      expectedRevision: 2,
    })
  } finally {
    await f.context.close()
  }
})

test('occupied order reload preserves metadata and requires a deliberate unused-order retry', async () => {
  const f = await fixture(true)
  try {
    await edit(f, true)
    await fail(f, true)
    f.state.occupied = true
    await reload(f, true)
    await fields(f, true)
    await f.form
      .getByText('Occupied display orders: 5.', { exact: false })
      .waitFor()
    await f.form
      .getByRole('button', {
        name: 'Keep my new deliverable edits',
        exact: true,
      })
      .click()
    assert.equal(
      await f.form
        .getByRole('button', { name: 'Create deliverable draft', exact: true })
        .isDisabled(),
      true,
    )
    await f.form
      .getByLabel('Deliverable display order', { exact: true })
      .fill('6')
    f.state.saveStatus = 201
    await f.form
      .getByRole('button', { name: 'Create deliverable draft', exact: true })
      .click()
    await f.page.waitForURL('**/deliverables/deliverable?version=version')
    assert.deepEqual(f.state.writes[1], {
      title: 'Local title',
      description: 'Local description',
      links: localLinks,
      required: false,
      position: 6,
    })
  } finally {
    await f.context.close()
  }
})

for (const create of [false, true])
  test(`refresh failure retains ${create ? 'new' : 'edited'} input and blocks unverified writes`, async () => {
    const f = await fixture(create)
    try {
      await edit(f, create)
      await fail(f, create)
      f.state.status = 503
      await reload(f, create)
      await fields(f, create)
      await f.form
        .getByRole('alert')
        .filter({ hasText: 'The latest state could not be verified' })
        .waitFor()
      assert.equal(
        await f.form
          .getByRole('button', {
            name: create
              ? 'Create deliverable draft'
              : 'Save deliverable draft',
            exact: true,
          })
          .isDisabled(),
        true,
      )
      await f.form.evaluate((form) =>
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
      )
      await f.page.waitForTimeout(100)
      assert.equal(f.state.writes.length, 1)
      f.state.status = 200
      await reload(f, create)
      await fields(f, create)
    } finally {
      await f.context.close()
    }
  })

test('discard confirms intent and loads all latest version values including links', async () => {
  const f = await fixture()
  try {
    await edit(f)
    await fail(f)
    f.state.version = {
      ...f.state.version,
      revision: 3,
      title: 'Latest title',
      description: 'Latest description',
      links: [{ label: 'Latest link', url: 'https://example.com/latest' }],
    }
    await reload(f)
    const discard = f.form.getByRole('button', {
      name: 'Discard my edits and use latest',
      exact: true,
    })
    f.page.once('dialog', (d) => d.dismiss())
    await discard.click()
    await fields(f)
    f.page.once('dialog', (d) => d.accept())
    await discard.click()
    assert.equal(
      await f.form
        .getByLabel('Deliverable title', { exact: true })
        .inputValue(),
      'Latest title',
    )
    assert.equal(
      await f.form
        .getByLabel('Deliverable description', { exact: true })
        .inputValue(),
      'Latest description',
    )
    assert.equal(
      await f.form.getByRole('button', { name: /Remove link/ }).count(),
      1,
    )
    assert.equal(
      await f.page.getByLabel('Link 1 label', { exact: true }).inputValue(),
      'Latest link',
    )
    assert.equal(
      await f.page.getByLabel('Link 1 HTTPS URL', { exact: true }).inputValue(),
      'https://example.com/latest',
    )
    assert.equal(f.state.writes.length, 1)
  } finally {
    await f.context.close()
  }
})

for (const condition of [
  'published',
  'missing version',
  'inaccessible',
  'held',
  'cancelled',
  'completed',
  'new held',
  'new inaccessible',
])
  test(`reload prevents writes and retains edits when ${condition}`, async () => {
    const create = condition.startsWith('new '),
      f = await fixture(create)
    try {
      await edit(f, create)
      await fail(f, create)
      if (condition === 'published') f.state.version.state = 'PUBLISHED'
      if (condition === 'missing version') f.state.version = null
      if (condition.includes('inaccessible')) f.state.status = 404
      if (condition.includes('held')) f.state.project = 'ON_HOLD'
      if (condition === 'cancelled') f.state.project = 'CANCELLED'
      if (condition === 'completed') f.state.project = 'COMPLETED'
      await reload(f, create)
      await fields(f, create)
      await f.form
        .getByRole('alert')
        .filter({
          hasText:
            condition === 'published'
              ? 'This version is published'
              : condition === 'missing version'
                ? 'This version is no longer accessible'
                : condition.includes('inaccessible')
                  ? 'The latest state could not be verified'
                  : 'This project is',
        })
        .waitFor()
      assert.equal(
        await f.form
          .getByRole('button', {
            name: create
              ? 'Create deliverable draft'
              : 'Save deliverable draft',
            exact: true,
          })
          .isDisabled(),
        true,
      )
      await f.form.evaluate((form) =>
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

test('refresh keeps added/removed link identity and navigation/unload guards', async () => {
  const f = await fixture()
  try {
    await edit(f)
    await fail(f)
    const ids = await f.form
      .locator('input[id^="link-label-"]')
      .evaluateAll((nodes) => nodes.map((n) => n.id))
    let release
    f.state.gate = new Promise((resolve) => {
      release = resolve
    })
    await f.form
      .getByRole('button', { name: 'Reload latest state', exact: true })
      .click()
    try {
      await fields(f)
      assert.deepEqual(
        await f.form
          .locator('input[id^="link-label-"]')
          .evaluateAll((nodes) => nodes.map((n) => n.id)),
        ids,
      )
      assert.equal(
        await f.form
          .getByRole('button', { name: 'Save deliverable draft', exact: true })
          .isDisabled(),
        true,
      )
    } finally {
      release()
    }
    await f.form
      .getByRole('button', {
        name: 'Keep my edits against revision 0',
        exact: true,
      })
      .waitFor()
    await f.page
      .getByRole('link', { name: '← Deliverable review', exact: true })
      .click()
    await f.page
      .getByText('Unsaved deliverable draft changes.', { exact: true })
      .waitFor()
    await f.page
      .getByRole('button', { name: 'Keep editing', exact: true })
      .click()
    await fields(f)
    assert.equal(
      await f.page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(event)
        return event.defaultPrevented
      }),
      true,
    )
  } finally {
    await f.context.close()
  }
})

test('discarding a failed new draft confirms clearing local fields and choosing the latest unused order', async () => {
  const f = await fixture(true)
  try {
    await edit(f, true)
    await fail(f, true)
    f.state.occupied = true
    await reload(f, true)
    const discard = f.form.getByRole('button', {
      name: 'Discard my edits and use latest',
      exact: true,
    })
    f.page.once('dialog', (d) => d.dismiss())
    await discard.click()
    await fields(f, true)
    f.page.once('dialog', (d) => d.accept())
    await discard.click()
    assert.equal(
      await f.form
        .getByLabel('Deliverable title', { exact: true })
        .inputValue(),
      '',
    )
    assert.equal(
      await f.form
        .getByLabel('Deliverable description', { exact: true })
        .inputValue(),
      '',
    )
    assert.equal(
      await f.form.getByRole('button', { name: /Remove link/ }).count(),
      0,
    )
    assert.equal(
      await f.form
        .getByLabel('Required deliverable', { exact: true })
        .isChecked(),
      true,
    )
    assert.equal(
      await f.form
        .getByLabel('Deliverable display order', { exact: true })
        .inputValue(),
      '1',
    )
    assert.equal(f.state.writes.length, 1)
  } finally {
    await f.context.close()
  }
})

test('duplicate submits issue only one update while pending', async () => {
  const f = await fixture()
  try {
    await edit(f)
    let release, received
    const ready = new Promise((resolve) => {
        received = resolve
      }),
      gate = new Promise((resolve) => {
        release = resolve
      })
    await f.context.route(
      '**/api' + detail + '/versions/version',
      async (route) => {
        f.state.writes.push(route.request().postDataJSON())
        received()
        await gate
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ versionId: 'version' }),
        })
      },
    )
    await f.form.evaluate((form) => {
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
        await f.form
          .getByRole('button', { name: 'Saving…', exact: true })
          .isDisabled(),
        true,
      )
    } finally {
      release()
    }
    await f.page.waitForURL('**/deliverables/deliverable?version=version')
    assert.equal(f.state.writes.length, 1)
  } finally {
    await f.context.close()
  }
})
