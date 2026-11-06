import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { Pool } from 'pg'
import { createHmac, randomUUID } from 'node:crypto'
import { createApp } from '../src/app.js'
import { readConfig } from '../src/config.js'
import { createDatabase } from '../src/database.js'
import { hashPassword, verifyPassword } from '../src/auth/password.js'
import { testDatabase } from '../../../scripts/database-safety.js'
import { createMailSink } from '../../../scripts/mail-sink-server.js'
import type { Identity } from '@jcb/contracts'
const url = testDatabase(process.env),
  tag = randomUUID(),
  secret = randomUUID()
const taggedUrl = (side: string) => {
  const value = new URL(url)
  value.searchParams.set('application_name', `jcb-auth-${side}-${tag}`)
  return value.toString()
}
const db = createDatabase(taggedUrl('a')),
  dbB = createDatabase(taggedUrl('b')),
  pool = new Pool({ connectionString: url }),
  poolB = new Pool({ connectionString: url })
const sink = createMailSink()
const origin = 'http://localhost:5173',
  password = 'A long test passphrase 2026!'
let instance: ReturnType<typeof createApp>,
  secondInstance: ReturnType<typeof createApp>
let server: Server, secondServer: Server
let owner: Identity,
  clientA: Identity,
  clientB: Identity,
  orgA: string,
  orgB: string
const email = (name: string) => `${name}-${tag}@example.test`
const keys = ['login', 'invite-send', 'invite-accept'].flatMap((scope) =>
  ['127.0.0.1', '::ffff:127.0.0.1', '::1'].map((ip) =>
    createHmac('sha256', secret).update(`${scope}:${ip}`).digest('hex'),
  ),
)
type Agent = ReturnType<typeof request.agent>
const agent = () => request.agent(server)
const sessions = new Set<string>()
async function csrf(client: Agent) {
  const response = await client.get('/api/auth/csrf')
  expect(response.status).toBe(200)
  track(response)
  return response.body.token as string
}
function track(response: request.Response) {
  const cookies = response.headers['set-cookie'] as unknown as
    string[] | undefined
  for (const cookie of cookies ?? []) {
    const signed = cookie.split(';')[0]?.split('=').slice(1).join('=')
    if (signed) {
      const id = decodeURIComponent(signed).slice(2).split('.')[0]
      if (id) sessions.add(id)
    }
  }
}
function firstCookie(response: request.Response) {
  const values = response.headers['set-cookie']
  if (!Array.isArray(values) || typeof values[0] !== 'string')
    throw new Error('Expected a session cookie.')
  return values[0]
}
async function post(
  client: Agent,
  path: string,
  body: Record<string, unknown> = {},
) {
  const token = await csrf(client)
  const response = await client
    .post(path)
    .set('Origin', origin)
    .set('X-CSRF-Token', token)
    .send(body)
  track(response)
  return response
}
async function login(user: Identity) {
  const client = agent()
  const result = await post(client, '/api/auth/login', {
    email: user.email,
    password,
  })
  expect(result.status).toBe(200)
  expect(result.body.user.id).toBe(user.id)
  return client
}
async function invite(client: Agent, to: string, org = orgA) {
  const response = await post(client, `/api/organizations/${org}/invitations`, {
    email: to,
  })
  expect(response.status).toBe(201)
  const token = sink.messages[0]!.text.match(/#token=([a-f0-9]{64})/)![1]!
  expect(JSON.stringify(response.body)).not.toContain(token)
  expect(JSON.stringify(response.body)).not.toContain('tokenHash')
  return { token, id: response.body.invitation.id as string }
}
beforeAll(async () => {
  await new Promise<void>((resolve) =>
    sink.smtp.listen(0, '127.0.0.1', resolve),
  )
  const address = sink.smtp.server.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing SMTP port')
  const config = readConfig({
    APP_ORIGIN: origin,
    DATABASE_URL: url,
    SESSION_SECRET: secret,
    NODE_ENV: 'test',
    SMTP_PORT: String(address.port),
  })
  instance = createApp(config, pool, { db })
  server = instance.app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  secondInstance = createApp(config, poolB, { db: dbB })
  secondServer = secondInstance.app.listen(0, '127.0.0.1')
  await once(secondServer, 'listening')
  const hash = await hashPassword(password)
  owner = await db.user.create({
    data: {
      email: email('owner'),
      name: 'Test owner',
      role: 'OWNER',
      passwordHash: hash,
    },
  })
  clientA = await db.user.create({
    data: { email: email('client-a'), name: 'Client A', passwordHash: hash },
  })
  clientB = await db.user.create({
    data: { email: email('client-b'), name: 'Client B', passwordHash: hash },
  })
  orgA = (
    await db.organization.create({
      data: { name: `Harbor ${tag}`, notes: 'OWNER PRIVATE NOTES' },
    })
  ).id
  orgB = (await db.organization.create({ data: { name: `Luma ${tag}` } })).id
  await db.membership.createMany({
    data: [
      { organizationId: orgA, userId: clientA.id },
      { organizationId: orgB, userId: clientB.id },
    ],
  })
}, 30000)
beforeEach(async () => {
  await db.authThrottle.deleteMany({ where: { key: { in: keys } } })
})
afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  if (secondServer)
    await new Promise<void>((resolve) => secondServer.close(() => resolve()))
  secondInstance?.store.close()
  instance?.store.close()
  await new Promise<void>((resolve) => sink.smtp.close(resolve))
  const organizationIds = [orgA, orgB].filter(Boolean)
  // Cleanup only this run's generated fixtures and sessions. No database reset.
  await db.activityEvent.deleteMany({
    where: { organizationId: { in: organizationIds } },
  })
  await db.invitation.deleteMany({
    where: { organizationId: { in: organizationIds } },
  })
  await db.membership.deleteMany({
    where: { organizationId: { in: organizationIds } },
  })
  await db.contact.deleteMany({
    where: { organizationId: { in: organizationIds } },
  })
  await db.organization.deleteMany({
    where: {
      OR: [{ id: { in: organizationIds } }, { name: { endsWith: tag } }],
    },
  })
  await db.user.deleteMany({
    where: { email: { endsWith: `-${tag}@example.test` } },
  })
  await db.session.deleteMany({ where: { sid: { in: [...sessions] } } })
  await db.authThrottle.deleteMany({ where: { key: { in: keys } } })
  await pool.end()
  await poolB.end()
  await dbB.$disconnect()
  await db.$disconnect()
})
describe('authentication and session boundaries', () => {
  it('verifies Argon2id, returns generic errors, and rejects browser roles', async () => {
    const client = agent()
    const wrong = await post(client, '/api/auth/login', {
      email: owner.email,
      password: 'wrong',
    })
    const unknown = await post(client, '/api/auth/login', {
      email: email('unknown'),
      password: 'wrong',
    })
    expect(wrong.status).toBe(401)
    expect(unknown.body).toEqual(wrong.body)
    expect(
      (
        await post(client, '/api/auth/login', {
          email: owner.email,
          password,
          role: 'OWNER',
        })
      ).status,
    ).toBe(401)
    const record = await db.user.findUniqueOrThrow({ where: { id: owner.id } })
    expect(record.passwordHash).toMatch(/^\$argon2id\$/)
    expect(await verifyPassword(password, record.passwordHash)).toBe(true)
  })
  it('regenerates on login and invalidates old and logged-out sessions', async () => {
    const client = agent(),
      before = await client.get('/api/auth/csrf')
    track(before)
    const oldCookie = firstCookie(before).split(';')[0]!
    const result = await post(client, '/api/auth/login', {
      email: owner.email.toUpperCase(),
      password,
    })
    expect(result.status).toBe(200)
    expect(firstCookie(result).split(';')[0]!).not.toBe(oldCookie)
    expect(firstCookie(result)).toContain('HttpOnly')
    expect(firstCookie(result)).toContain('SameSite=Lax')
    expect(JSON.stringify(result.body)).not.toContain('passwordHash')
    expect(
      (await request(server).get('/api/auth/me').set('Cookie', oldCookie))
        .status,
    ).toBe(401)
    const authenticatedCookie = firstCookie(result).split(';')[0]!
    expect((await post(client, '/api/auth/logout')).status).toBe(204)
    expect((await client.get('/api/auth/me')).status).toBe(401)
    expect(
      (
        await request(server)
          .get('/api/auth/me')
          .set('Cookie', authenticatedCookie)
      ).status,
    ).toBe(401)
  })
  it('rejects missing/stale/invalid CSRF and missing or wrong origins', async () => {
    const client = await login(owner),
      token = await csrf(client)
    expect(
      (
        await client
          .post('/api/organizations')
          .set('Origin', origin)
          .send({ name: 'CSRF' })
      ).status,
    ).toBe(403)
    expect(
      (
        await client
          .post('/api/organizations')
          .set('Origin', origin)
          .set('X-CSRF-Token', 'a'.repeat(64))
          .send({ name: 'CSRF' })
      ).status,
    ).toBe(403)
    for (const badOrigin of ['', 'https://evil.example'])
      expect(
        (
          await client
            .post('/api/auth/logout')
            .set('Origin', badOrigin)
            .set('X-CSRF-Token', token)
        ).status,
      ).toBe(403)
    const oldToken = token
    expect(
      (await post(client, '/api/auth/login', { email: owner.email, password }))
        .status,
    ).toBe(200)
    expect(
      (
        await client
          .post('/api/auth/logout')
          .set('Origin', origin)
          .set('X-CSRF-Token', oldToken)
      ).status,
    ).toBe(403)
  })
  it('expires sessions absolutely and rechecks disabled users', async () => {
    const client = await login(clientA)
    const response = await client.get('/api/auth/csrf')
    const rows = await db.session.findMany({
      where: { sid: { in: [...sessions] } },
    })
    const row = rows.find((row) =>
      JSON.stringify(row.sess).includes(clientA.id),
    )!
    const data = row.sess as Record<string, PrismaJson>
    await db.session.update({
      where: { sid: row.sid },
      data: {
        sess: {
          ...data,
          authenticatedAt: Date.now() - 8 * 60 * 60 * 1000 - 1000,
        },
      },
    })
    expect(response.status).toBe(200)
    expect((await client.get('/api/auth/me')).status).toBe(401)
    expect(await db.session.findUnique({ where: { sid: row.sid } })).toBeNull()
    const disabled = await login(clientB)
    await db.user.update({
      where: { id: clientB.id },
      data: { disabledAt: new Date() },
    })
    try {
      expect((await disabled.get('/api/auth/me')).status).toBe(401)
      expect(
        (
          await post(agent(), '/api/auth/login', {
            email: clientB.email,
            password,
          })
        ).status,
      ).toBe(401)
    } finally {
      await db.user.update({
        where: { id: clientB.id },
        data: { disabledAt: null },
      })
    }
  })
  it('throttles login attempts persistently in PostgreSQL', async () => {
    const client = agent(),
      token = await csrf(client)
    for (let i = 0; i < 10; i++)
      expect(
        (
          await client
            .post('/api/auth/login')
            .set('Origin', origin)
            .set('X-CSRF-Token', token)
            .send({ email: owner.email, password: 'wrong' })
        ).status,
      ).toBe(401)
    const blocked = await client
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({ email: owner.email, password })
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    const spoofed = await client
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .set('X-Forwarded-For', '203.0.113.123')
      .send({ email: owner.email, password })
    expect(spoofed.status).toBe(429)
    expect(
      await db.authThrottle.count({
        where: { key: { in: keys }, count: { gt: 10 } },
      }),
    ).toBe(1)
  }, 20000)
})
type PrismaJson =
  | string
  | number
  | boolean
  | null
  | PrismaJson[]
  | { [key: string]: PrismaJson }
describe('organizations and authorization', () => {
  it('allows owner organization/contact edits and keeps contacts separate from access', async () => {
    const own = await login(owner)
    const created = await post(own, '/api/organizations', {
      name: `New ${tag}`,
      notes: 'Private',
    })
    expect(created.status).toBe(201)
    const org = created.body.organization.id
    expect(
      (
        await own
          .patch(`/api/organizations/${org}`)
          .set('Origin', origin)
          .set('X-CSRF-Token', await csrf(own))
          .send({ name: `Updated ${tag}` })
      ).status,
    ).toBe(200)
    const contact = await post(own, `/api/organizations/${orgA}/contacts`, {
      name: 'Contact only',
      email: clientB.email,
    })
    expect(contact.status).toBe(201)
    const other = await login(clientB)
    expect((await other.get(`/api/organizations/${orgA}`)).status).toBe(404)
    expect(
      (
        await own
          .patch(
            `/api/organizations/${orgB}/contacts/${contact.body.contact.id}`,
          )
          .set('Origin', origin)
          .set('X-CSRF-Token', await csrf(own))
          .send({ name: 'Cross-org change' })
      ).status,
    ).toBe(404)
  })
  it('isolates direct requests and lists across two organizations, without leaking owner notes', async () => {
    const a = await login(clientA),
      b = await login(clientB)
    for (const [client, own, other] of [
      [a, orgA, orgB],
      [b, orgB, orgA],
    ] as const) {
      const list = await client.get('/api/organizations')
      expect(list.status).toBe(200)
      expect(
        list.body.organizations.map((org: { id: string }) => org.id),
      ).toEqual([own])
      const detail = await client.get(`/api/organizations/${own}`)
      expect(detail.status).toBe(200)
      expect(detail.body.organization.notes).toBeUndefined()
      expect(detail.body.contacts).toBeUndefined()
      expect(detail.body.activities).toBeUndefined()
      expect((await client.get(`/api/organizations/${other}`)).status).toBe(404)
      expect(
        (await post(client, '/api/organizations', { name: 'Unauthorized' }))
          .status,
      ).toBe(403)
      expect(
        (
          await post(client, `/api/organizations/${own}/invitations`, {
            email: email('unauthorized'),
          })
        ).status,
      ).toBe(403)
      expect(
        (
          await post(client, `/api/organizations/${own}/contacts`, {
            name: 'Bad',
            email: email('bad'),
          })
        ).status,
      ).toBe(403)
      expect(
        (
          await client
            .patch(`/api/organizations/${own}`)
            .set('Origin', origin)
            .set('X-CSRF-Token', await csrf(client))
            .send({ name: 'Bad' })
        ).status,
      ).toBe(403)
    }
    expect((await agent().get(`/api/organizations/${orgA}`)).status).toBe(401)
  })
  it('revokes organization access immediately without relying on logout', async () => {
    const own = await login(owner),
      client = await login(clientA)
    const membership = await db.membership.findUniqueOrThrow({
      where: {
        organizationId_userId: { organizationId: orgA, userId: clientA.id },
      },
    })
    expect(
      (
        await own
          .delete(`/api/organizations/${orgA}/memberships/${membership.id}`)
          .set('Origin', origin)
          .set('X-CSRF-Token', await csrf(own))
      ).status,
    ).toBe(204)
    expect((await client.get(`/api/organizations/${orgA}`)).status).toBe(404)
    const invitation = await invite(own, clientA.email)
    expect(
      (
        await post(client, '/api/invitations/accept', {
          token: invitation.token,
        })
      ).status,
    ).toBe(200)
    expect(
      await db.membership.count({
        where: { organizationId: orgA, userId: clientA.id },
      }),
    ).toBe(1)
    expect((await client.get(`/api/organizations/${orgA}`)).status).toBe(200)
  })
})
describe('invitations and onboarding', () => {
  it('delivers SMTP mail, stores only a token hash, and derives the new account email from the token', async () => {
    const own = await login(owner),
      client = agent(),
      address = email('new-user')
    const invitation = await invite(own, address)
    const stored = await db.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
    })
    expect(stored.tokenHash).not.toBe(invitation.token)
    expect(stored.tokenHash).toHaveLength(64)
    expect(
      stored.expiresAt.getTime() - stored.createdAt.getTime(),
    ).toBeGreaterThan(71.99 * 3600000)
    expect(stored.deliveredAt).not.toBeNull()
    const preview = await post(client, '/api/invitations/inspect', {
      token: invitation.token,
    })
    expect(preview.body).toMatchObject({ email: address, accountExists: false })
    for (const fields of [
      { email: owner.email },
      { userId: owner.id },
      { role: 'OWNER' },
    ])
      expect(
        (
          await post(client, '/api/invitations/accept', {
            token: invitation.token,
            name: 'New client',
            password,
            ...fields,
          })
        ).status,
      ).toBe(400)
    expect(
      (
        await post(client, '/api/invitations/accept', {
          token: invitation.token,
          name: 'New client',
          password: 'short',
        })
      ).status,
    ).toBe(400)
    const result = await post(client, '/api/invitations/accept', {
      token: invitation.token,
      name: 'New client',
      password,
    })
    expect(result.status).toBe(200)
    expect(result.body.user).toMatchObject({ email: address, role: 'CLIENT' })
    expect((await client.get('/api/auth/me')).body.user.email).toBe(address)
    expect((await client.get(`/api/organizations/${orgB}`)).status).toBe(404)
    expect(
      (
        await post(client, '/api/invitations/accept', {
          token: invitation.token,
        })
      ).status,
    ).toBe(410)
    const safe = JSON.stringify(
      await db.activityEvent.findMany({ where: { targetId: invitation.id } }),
    )
    expect(safe).not.toContain(password)
    expect(safe).not.toContain(invitation.token)
    expect(safe).not.toContain(secret)
  })
  it('requires existing-user login and matching email; never replaces a password', async () => {
    const own = await login(owner),
      invitation = await invite(own, clientB.email)
    expect(
      (
        await post(agent(), '/api/invitations/accept', {
          token: invitation.token,
          name: 'Impostor',
          password,
        })
      ).status,
    ).toBe(401)
    const wrong = await login(clientA)
    expect(
      (
        await post(wrong, '/api/invitations/accept', {
          token: invitation.token,
        })
      ).status,
    ).toBe(403)
    expect(
      (await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } }))
        .acceptedAt,
    ).toBeNull()
    const correct = await login(clientB),
      hash = (await db.user.findUniqueOrThrow({ where: { id: clientB.id } }))
        .passwordHash
    expect(
      (
        await post(correct, '/api/invitations/accept', {
          token: invitation.token,
          password: 'A different password!',
        })
      ).status,
    ).toBe(200)
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: clientB.id } }))
        .passwordHash,
    ).toBe(hash)
    // Remove only the membership just created by this test, preserving the base fixtures.
    await db.membership.update({
      where: {
        organizationId_userId: { organizationId: orgA, userId: clientB.id },
      },
      data: { revokedAt: new Date() },
    })
  })
  it('rejects expired, revoked, unknown and archived-organization invitations', async () => {
    const own = await login(owner),
      client = agent()
    const expired = await invite(own, email('expired'))
    await db.invitation.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    expect(
      (
        await post(client, '/api/invitations/accept', {
          token: expired.token,
          name: 'Expired',
          password,
        })
      ).status,
    ).toBe(410)
    const old = await invite(own, email('reissue')),
      renewed = await invite(own, email('reissue'))
    expect(
      (await post(client, '/api/invitations/inspect', { token: old.token }))
        .status,
    ).toBe(410)
    expect(
      (await post(client, '/api/invitations/inspect', { token: renewed.token }))
        .status,
    ).toBe(200)
    expect(
      (
        await post(client, '/api/invitations/inspect', {
          token: '0'.repeat(64),
        })
      ).status,
    ).toBe(410)
    const archived = await invite(own, email('archived'))
    await db.organization.update({
      where: { id: orgA },
      data: { archivedAt: new Date() },
    })
    try {
      expect(
        (
          await post(client, '/api/invitations/accept', {
            token: archived.token,
            name: 'Archived',
            password,
          })
        ).status,
      ).toBe(410)
    } finally {
      await db.organization.update({
        where: { id: orgA },
        data: { archivedAt: null },
      })
    }
  })
  it('consumes a token once under concurrent new-user requests and never duplicates memberships', async () => {
    const own = await login(owner),
      invitation = await invite(own, email('concurrent')),
      client = agent(),
      secondClient = request.agent(secondServer),
      token = await csrf(client),
      secondToken = await csrf(secondClient)
    const accept = (agent: Agent, csrfToken: string) =>
      agent
        .post('/api/invitations/accept')
        .set('Origin', origin)
        .set('X-CSRF-Token', csrfToken)
        .send({ token: invitation.token, name: 'Concurrent client', password })
        .then((response) => {
          track(response)
          return response
        })
    const coordinator = await pool.connect()
    let pending: Promise<request.Response>[],
      blocked = false
    try {
      await coordinator.query('BEGIN')
      // A harmless fixture row update forces raw SELECT FOR UPDATE serialization
      // conflicts after both independent API connections are waiting.
      await coordinator.query(
        'UPDATE organizations SET name = name WHERE id = $1',
        [orgA],
      )
      pending = [accept(client, token), accept(secondClient, secondToken)]
      for (let i = 0; i < 300; i++) {
        const waiting = await poolB.query<{ count: string }>(
          "SELECT count(*) FROM pg_stat_activity WHERE application_name = ANY($1::text[]) AND wait_event_type = 'Lock'",
          [[`jcb-auth-a-${tag}`, `jcb-auth-b-${tag}`]],
        )
        if (Number(waiting.rows[0]!.count) >= 2) {
          blocked = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      await coordinator.query('COMMIT')
    } finally {
      await coordinator.query('ROLLBACK')
      coordinator.release()
    }
    const results = await Promise.all(pending)
    expect(
      blocked,
      'Both independent connections must overlap before release',
    ).toBe(true)
    expect(results.map((r) => r.status).sort()).toEqual([200, 410])
    const user = await db.user.findUniqueOrThrow({
      where: { email: email('concurrent') },
    })
    expect(
      await db.membership.count({
        where: { userId: user.id, organizationId: orgA },
      }),
    ).toBe(1)
    expect(
      await db.activityEvent.count({
        where: { targetId: invitation.id, kind: 'INVITATION_ACCEPTED' },
      }),
    ).toBe(1)
    const again = await invite(own, user.email)
    const signedIn = await login(user)
    expect(
      (await post(signedIn, '/api/invitations/accept', { token: again.token }))
        .status,
    ).toBe(200)
    expect(
      await db.membership.count({
        where: { userId: user.id, organizationId: orgA },
      }),
    ).toBe(1)
    const membership = await db.membership.findUniqueOrThrow({
      where: {
        organizationId_userId: { organizationId: orgA, userId: user.id },
      },
    })
    expect(
      await db.activityEvent.count({
        where: { kind: 'MEMBERSHIP_ACTIVATED', targetId: membership.id },
      }),
    ).toBe(1)
  })
  it('reports delivery failure without returning a token and revokes the undelivered invitation', async () => {
    const config = readConfig({
      APP_ORIGIN: origin,
      DATABASE_URL: url,
      SESSION_SECRET: secret,
      NODE_ENV: 'test',
    })
    const failed = createApp(config, pool, {
      db,
      mailer: async () => {
        throw new Error('SMTP unavailable')
      },
    })
    const failedServer = failed.app.listen(0, '127.0.0.1')
    await once(failedServer, 'listening')
    try {
      const client = request.agent(failedServer)
      expect(
        (
          await post(client, '/api/auth/login', {
            email: owner.email,
            password,
          })
        ).status,
      ).toBe(200)
      const result = await post(
        client,
        `/api/organizations/${orgA}/invitations`,
        { email: email('delivery-failed') },
      )
      expect(result.status).toBe(502)
      expect(Object.keys(result.body)).toEqual(['error'])
      const invitation = await db.invitation.findFirstOrThrow({
        where: { email: email('delivery-failed') },
      })
      expect(invitation.revokedAt).not.toBeNull()
      expect(invitation.deliveryFailed).toBe(true)
    } finally {
      await new Promise<void>((resolve) => failedServer.close(() => resolve()))
      failed.store.close()
    }
  })
})
