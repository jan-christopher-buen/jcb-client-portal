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
const base = 'http://127.0.0.1:5197'
const path = '/organizations/org/projects/project/changes/request'
const apiPath = '/api' + path
const editor = path + '/offers/offer/edit'
const initial = {
  id: 'offer',
  number: 1,
  revision: 0,
  state: 'DRAFT',
  scope: 'Server scope',
  exclusions: 'Server exclusions',
  adjustmentMinor: '1200',
  scheduleImpact: 'Server schedule',
  publishedAt: null,
  decision: null,
}
const local = {
  scope: 'Local scope',
  exclusions: 'Local exclusions',
  price: '-34.56',
  schedule: 'Local schedule',
}
const labels = {
  scope: 'Offered scope',
  exclusions: 'Offer exclusions',
  price: 'Price adjustment (PHP)',
  schedule: 'Schedule impact',
}
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
      '5197',
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
async function fixture() {
  const context = await browser.newContext(),
    page = await context.newPage()
  const state = {
    offer: { ...initial },
    project: 'ACTIVE',
    request: 'OPEN',
    getStatus: 200,
    saveStatus: 500,
    writes: [],
    gate: null,
  }
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      method = route.request().method()
    let status = 200,
      body = {}
    if (url.pathname === '/api/auth/me')
      body = {
        user: {
          id: 'owner',
          name: 'Fictional owner',
          email: 'owner@example.test',
          role: 'OWNER',
        },
      }
    else if (url.pathname === '/api/auth/csrf') body = { token: 'a'.repeat(64) }
    else if (url.pathname === apiPath && method === 'GET') {
      if (state.gate) await state.gate
      status = state.getStatus
      body =
        status === 200
          ? {
              project: { id: 'project', status: state.project, revision: 0 },
              request: {
                id: 'request',
                title: 'Fictional request',
                state: state.request,
                offers: [{ ...state.offer }],
                messages: [],
                creator: { name: 'Fictional client' },
                createdAt: '2026-11-07T00:00:00Z',
              },
              amounts: {
                originalMinor: '10000',
                adjustmentsMinor: '0',
                revisedMinor: '10000',
                approvedChanges: [],
              },
            }
          : { error: { code: 'NOT_FOUND', message: 'Request unavailable.' } }
    } else if (
      url.pathname === apiPath + '/offers/offer' &&
      method === 'PATCH'
    ) {
      state.writes.push(route.request().postDataJSON())
      status = state.saveStatus
      body =
        status === 200
          ? { offerId: 'offer' }
          : {
              error: {
                code: status === 409 ? 'STALE_REVISION' : 'INTERNAL_ERROR',
                message:
                  status === 409
                    ? 'Draft changed. Reload latest state.'
                    : 'Save failed.',
              },
            }
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  page.setDefaultTimeout(5000)
  await page.goto(base + editor)
  await page.getByLabel(labels.scope, { exact: true }).waitFor()
  return { context, page, state }
}
async function edit(page) {
  for (const [key, label] of Object.entries(labels))
    await page.getByLabel(label, { exact: true }).fill(local[key])
}
async function fields(page, expected = local) {
  for (const [key, label] of Object.entries(labels))
    assert.equal(
      await page.getByLabel(label, { exact: true }).inputValue(),
      expected[key],
    )
}
async function fail(page) {
  await page
    .getByRole('button', { name: 'Save offer draft', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Reload latest state', exact: true })
    .waitFor()
}

test('failed save → reload preserves every edited field during and after fetching', async () => {
  const { context, page, state } = await fixture()
  try {
    await edit(page)
    await fail(page)
    let release
    state.gate = new Promise((resolve) => {
      release = resolve
    })
    await page
      .getByRole('button', { name: 'Reload latest state', exact: true })
      .click()
    try {
      await fields(page)
    } finally {
      release()
    }
    await page
      .getByRole('status')
      .filter({ hasText: 'Loading offer editor' })
      .waitFor({ state: 'hidden' })
    await fields(page)
  } finally {
    await context.close()
  }
})

test('stale save → reload requires deliberate comparison/reconciliation before retry', async () => {
  const { context, page, state } = await fixture()
  try {
    await edit(page)
    state.saveStatus = 409
    await fail(page)
    state.offer = {
      ...state.offer,
      revision: 1,
      scope: 'Newer server scope',
      exclusions: 'Newer server exclusions',
      adjustmentMinor: '9876',
      scheduleImpact: 'Newer server schedule',
    }
    await page
      .getByRole('button', { name: 'Reload latest state', exact: true })
      .click()
    const review = page.getByRole('region', {
      name: 'Review latest server offer',
    })
    await review
      .getByText('Latest server revision: 1', { exact: true })
      .waitFor()
    await fields(page)
    assert.equal(
      await page
        .getByRole('button', { name: 'Save offer draft', exact: true })
        .isDisabled(),
      true,
    )
    for (const value of [
      'Newer server scope',
      'Newer server exclusions',
      'Newer server schedule',
      'Latest price adjustment: PHP 98.76',
    ])
      await review.getByText(value, { exact: true }).waitFor()
    assert.equal(state.writes.length, 1)
    await page
      .getByLabel(labels.scope, { exact: true })
      .fill('Reconciled scope')
    await page
      .getByRole('button', {
        name: 'Keep my edits against revision 1',
        exact: true,
      })
      .click()
    state.saveStatus = 200
    await page
      .getByRole('button', { name: 'Save offer draft', exact: true })
      .click()
    await page.waitForURL('**/changes/request?offer=offer')
    assert.deepEqual(state.writes[1], {
      scope: 'Reconciled scope',
      exclusions: local.exclusions,
      adjustmentMinor: '-3456',
      scheduleImpact: local.schedule,
      expectedRevision: 1,
    })
  } finally {
    await context.close()
  }
})

test('explicit discard confirms intent and loads all latest server values', async () => {
  const { context, page, state } = await fixture()
  try {
    await edit(page)
    await fail(page)
    state.offer = {
      ...state.offer,
      revision: 2,
      scope: 'Latest scope',
      exclusions: 'Latest exclusions',
      adjustmentMinor: '-1050',
      scheduleImpact: 'Latest schedule',
    }
    await page
      .getByRole('button', { name: 'Reload latest state', exact: true })
      .click()
    const discard = page.getByRole('button', {
      name: 'Discard my edits and use latest',
      exact: true,
    })
    page.once('dialog', (dialog) => dialog.dismiss())
    await discard.click()
    await fields(page)
    page.once('dialog', (dialog) => dialog.accept())
    await discard.click()
    await fields(page, {
      scope: 'Latest scope',
      exclusions: 'Latest exclusions',
      price: '-10.50',
      schedule: 'Latest schedule',
    })
    assert.equal(state.writes.length, 1)
    assert.equal(
      await page
        .getByRole('button', { name: 'Save offer draft', exact: true })
        .isEnabled(),
      true,
    )
  } finally {
    await context.close()
  }
})

for (const condition of [
  'published',
  'approved',
  'held',
  'cancelled',
  'completed',
  'closed',
  'inaccessible',
  'refresh failed',
]) {
  test(`reload retains input and prevents another save when ${condition}`, async () => {
    const { context, page, state } = await fixture()
    try {
      await edit(page)
      await fail(page)
      if (condition === 'published') state.offer.state = 'PUBLISHED'
      if (condition === 'approved') state.request = 'APPROVED'
      if (condition === 'held') state.project = 'ON_HOLD'
      if (condition === 'cancelled') state.project = 'CANCELLED'
      if (condition === 'completed') state.project = 'COMPLETED'
      if (condition === 'closed') state.request = 'CLOSED'
      if (condition === 'inaccessible') state.getStatus = 404
      if (condition === 'refresh failed') state.getStatus = 503
      await page
        .getByRole('button', { name: 'Reload latest state', exact: true })
        .click()
      const reason =
        condition === 'published'
          ? 'This offer is published'
          : condition === 'approved' || condition === 'closed'
            ? 'This request is'
            : condition === 'inaccessible' || condition === 'refresh failed'
              ? 'The latest state could not be verified'
              : 'This project is'
      await page.getByRole('alert').filter({ hasText: reason }).waitFor()
      await fields(page)
      assert.equal(
        await page
          .getByRole('button', { name: 'Save offer draft', exact: true })
          .isDisabled(),
        true,
      )
      // A synthetic submit still must not issue an HTTP write.
      await page
        .getByLabel(labels.scope, { exact: true })
        .evaluate((element) =>
          element.form.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          ),
        )
      assert.equal(state.writes.length, 1)
    } finally {
      await context.close()
    }
  })
}

test('retained edits continue to guard navigation and supported unload events', async () => {
  const { context, page } = await fixture()
  try {
    await edit(page)
    await fail(page)
    await page
      .getByRole('button', { name: 'Reload latest state', exact: true })
      .click()
    await page
      .getByRole('button', {
        name: 'Keep my edits against revision 0',
        exact: true,
      })
      .waitFor()
    await page
      .getByRole('link', { name: '← Change request review', exact: true })
      .click()
    await page.getByText('Unsaved offer changes.', { exact: true }).waitFor()
    await page
      .getByRole('button', { name: 'Keep editing', exact: true })
      .click()
    await fields(page)
    assert.equal(
      await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(event)
        return event.defaultPrevented
      }),
      true,
    )
  } finally {
    await context.close()
  }
})
