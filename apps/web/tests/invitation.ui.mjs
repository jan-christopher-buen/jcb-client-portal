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
const base = 'http://127.0.0.1:5196'
const apiPath = '/api/organizations/org'
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
      '5196',
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
async function fixture() {
  const context = await browser.newContext(),
    page = await context.newPage()
  const state = { writes: [], status: 502, delivery: 'unconfirmed' }
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    let body = {},
      status = 200
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
    else if (url.pathname === apiPath + '/invitations') {
      state.writes.push(route.request().postDataJSON())
      status = state.status
      body =
        status === 201
          ? { invitation: { id: 'invite', delivery: state.delivery } }
          : {
              error: {
                code: 'UNAVAILABLE',
                message: 'Temporary request failure.',
              },
            }
    } else if (url.pathname === apiPath)
      body = {
        organization: {
          id: 'org',
          name: 'Fictional org',
          notes: '',
          archivedAt: null,
        },
        contacts: [],
        memberships: [],
        invitations: [],
        activities: [],
      }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  await page.goto(base + '/organizations/org')
  await page.getByLabel('Invitation email').fill('client@example.test')
  return { page, state, context }
}
test('failed send and reload preserve recipient and request identity; retry checks without reissuing', async () => {
  const { page, state, context } = await fixture()
  try {
    await page
      .getByRole('button', { name: 'Send invitation', exact: true })
      .click()
    await page
      .getByText('Temporary request failure.', { exact: false })
      .waitFor()
    await page.getByRole('button', { name: 'Reload organization' }).click()
    await page.getByRole('button', { name: 'Check previous request' }).waitFor()
    assert.equal(
      await page.getByLabel('Invitation email').inputValue(),
      'client@example.test',
    )
    assert.equal(await page.getByLabel('Invitation email').isDisabled(), true)
    state.status = 201
    await page.getByRole('button', { name: 'Check previous request' }).click()
    await page
      .getByRole('status')
      .filter({ hasText: 'Delivery is unconfirmed' })
      .waitFor()
    assert.equal(state.writes.length, 2)
    assert.deepEqual(state.writes[0], state.writes[1])
  } finally {
    await context.close()
  }
})
test('reissue requires confirmation and generates a fresh request key only after explicit intent', async () => {
  const { page, state, context } = await fixture()
  try {
    state.status = 201
    state.delivery = 'accepted'
    await page
      .getByRole('button', { name: 'Send invitation', exact: true })
      .click()
    await page
      .getByRole('status')
      .filter({ hasText: 'Inbox delivery is not confirmed' })
      .waitFor()
    page.once('dialog', (d) => d.dismiss())
    await page
      .getByRole('button', {
        name: 'Start new invitation / deliberate reissue',
      })
      .click()
    assert.equal(await page.getByLabel('Invitation email').isDisabled(), true)
    page.once('dialog', (d) => d.accept())
    await page
      .getByRole('button', {
        name: 'Start new invitation / deliberate reissue',
      })
      .click()
    await page
      .getByRole('button', { name: 'Send invitation', exact: true })
      .click()
    await page
      .getByRole('status')
      .filter({ hasText: 'Inbox delivery is not confirmed' })
      .waitFor()
    assert.equal(state.writes.length, 2)
    assert.notEqual(state.writes[0].requestKey, state.writes[1].requestKey)
    assert.equal(state.writes[0].reissueConfirmed, false)
    assert.equal(state.writes[1].reissueConfirmed, true)
  } finally {
    await context.close()
  }
})

test('invitation delivery wording stays mode-neutral and distinguishes provider acceptance from inbox delivery', async () => {
  const { page, state, context } = await fixture()
  try {
    const content = await page.locator('body').innerText()
    assert.doesNotMatch(
      content,
      /local(?:[-\s]+only)?\s+mail\s+sink|local[-\s]+only\s+delivery|no\s+external\s+email/i,
    )
    await page
      .getByText(
        'Check invitation status below. Mail-service acceptance does not confirm inbox delivery.',
        { exact: true },
      )
      .waitFor()
    state.status = 201
    state.delivery = 'accepted'
    await page
      .getByRole('button', { name: 'Send invitation', exact: true })
      .click()
    await page
      .getByRole('status')
      .filter({
        hasText:
          'Email accepted by the mail service. Inbox delivery is not confirmed.',
      })
      .waitFor()
  } finally {
    await context.close()
  }
})
