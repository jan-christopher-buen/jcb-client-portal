import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { once } from 'node:events'
import { randomUUID, createHmac } from 'node:crypto'
import { Pool } from 'pg'
import type { Server } from 'node:http'
import type { Identity, ProposalDraft, ProposalDto } from '@jcb/contracts'
import { createApp } from '../src/app.js'
import { readConfig } from '../src/config.js'
import { createDatabase } from '../src/database.js'
import { hashPassword } from '../src/auth/password.js'
import { testDatabase } from '../../../scripts/database-safety.js'
const url = testDatabase(process.env),
  tag = randomUUID(),
  secret = randomUUID(),
  origin = 'http://localhost:5173'
// Independent Prisma adapters/pools and API servers exercise separate DB connections.
const taggedUrl = (side: string) => {
  const value = new URL(url)
  value.searchParams.set('application_name', `jcb-proposal-${side}-${tag}`)
  return value.toString()
}
const dbA = createDatabase(taggedUrl('a')),
  dbB = createDatabase(taggedUrl('b')),
  poolA = new Pool({ connectionString: url }),
  poolB = new Pool({ connectionString: url })
const config = readConfig({
  NODE_ENV: 'test',
  DATABASE_URL: url,
  APP_ORIGIN: origin,
  SESSION_SECRET: secret,
})
const a = createApp(config, poolA, { db: dbA }),
  b = createApp(config, poolB, { db: dbB })
let serverA: Server,
  serverB: Server,
  owner: Identity,
  clientA: Identity,
  clientB: Identity,
  orgA: string,
  orgB: string
let own: Agent, client: Agent, second: Agent, other: Agent
const password = 'Proposal testing passphrase 2026!',
  sessions = new Set<string>()
type Agent = ReturnType<typeof request.agent>
function track(response: request.Response) {
  const cookies = response.headers['set-cookie'] as unknown as
    string[] | undefined
  for (const cookie of cookies ?? []) {
    const value = cookie.split(';')[0]?.split('=').slice(1).join('=')
    if (value) {
      const id = decodeURIComponent(value).slice(2).split('.')[0]
      if (id) sessions.add(id)
    }
  }
}
async function csrf(agent: Agent) {
  const response = await agent.get('/api/auth/csrf')
  expect(response.status).toBe(200)
  track(response)
  return response.body.token as string
}
async function mutate(
  agent: Agent,
  method: 'post' | 'patch',
  path: string,
  body: object = {},
) {
  const token = await csrf(agent)
  const result = await agent[method](path)
    .set('Origin', origin)
    .set('X-CSRF-Token', token)
    .send(body)
  track(result)
  return result
}
const base = (org = orgA) => `/api/organizations/${org}/proposals`
const draft = (title = 'Website proposal'): ProposalDraft => ({
  title,
  scope: 'Five-page website',
  exclusions: 'Hosting and domain fees',
  deliveryAssumptions: 'Client supplies copy',
  internalNotes: 'OWNER PRIVATE STRATEGY',
  currency: 'PHP',
  items: [
    { description: 'Implementation', quantity: 2, unitPriceMinor: '1750000' },
    { description: 'Handover', quantity: 1, unitPriceMinor: '0' },
  ],
})
async function create(title?: string, org = orgA) {
  const response = await mutate(own, 'post', base(org), draft(title))
  expect(response.status).toBe(201)
  return response.body as { proposalId: string; versionId: string }
}
async function send(
  record: { proposalId: string; versionId: string },
  revision = 0,
) {
  return mutate(
    own,
    'post',
    `${base()}/${record.proposalId}/versions/${record.versionId}/send`,
    { expectedRevision: revision },
  )
}
async function decide(
  agent: Agent,
  record: { proposalId: string; versionId: string },
  outcome = 'APPROVED',
) {
  return mutate(
    agent,
    'post',
    `${base()}/${record.proposalId}/versions/${record.versionId}/decision`,
    { outcome },
  )
}
async function read(record: { proposalId: string }, agent = own) {
  const response = await agent.get(`${base()}/${record.proposalId}`)
  expect(response.status).toBe(200)
  return response.body.proposal as ProposalDto
}
async function contend(operations: (() => Promise<request.Response>)[]) {
  const coordinator = await poolA.connect()
  let pending: Promise<request.Response>[],
    blocked = false
  try {
    await coordinator.query('BEGIN')
    await coordinator.query(
      'SELECT id FROM organizations WHERE id = $1 FOR UPDATE',
      [orgA],
    )
    pending = operations.map((run) => run())
    for (let i = 0; i < 200; i++) {
      const rows = await poolB.query<{ count: string }>(
        "SELECT count(*) FROM pg_stat_activity WHERE application_name = ANY($1::text[]) AND wait_event_type = 'Lock'",
        [[`jcb-proposal-a-${tag}`, `jcb-proposal-b-${tag}`]],
      )
      if (Number(rows.rows[0]!.count) >= 2) {
        blocked = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  } finally {
    await coordinator.query('ROLLBACK')
    coordinator.release()
  }
  const results = await Promise.all(pending)
  expect(
    blocked,
    'Both separate database connections must overlap at the organization lock',
  ).toBe(true)
  return results
}
beforeAll(async () => {
  const [pidA, pidB] = await Promise.all([
    dbA.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`,
    dbB.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`,
  ])
  expect(pidA[0]!.pid).not.toBe(pidB[0]!.pid)
  serverA = a.app.listen(0, '127.0.0.1')
  serverB = b.app.listen(0, '127.0.0.1')
  await Promise.all([once(serverA, 'listening'), once(serverB, 'listening')])
  const passwordHash = await hashPassword(password)
  owner = await dbA.user.create({
    data: {
      name: 'Proposal owner',
      email: `owner-${tag}@example.test`,
      role: 'OWNER',
      passwordHash,
    },
  })
  clientA = await dbA.user.create({
    data: {
      name: 'Harbor client',
      email: `a-${tag}@example.test`,
      passwordHash,
    },
  })
  clientB = await dbA.user.create({
    data: { name: 'Luma client', email: `b-${tag}@example.test`, passwordHash },
  })
  orgA = (await dbA.organization.create({ data: { name: `Harbor ${tag}` } })).id
  orgB = (await dbA.organization.create({ data: { name: `Luma ${tag}` } })).id
  await dbA.membership.createMany({
    data: [
      { organizationId: orgA, userId: clientA.id },
      { organizationId: orgB, userId: clientB.id },
    ],
  })
  own = request.agent(serverA)
  client = request.agent(serverA)
  second = request.agent(serverB)
  other = request.agent(serverA)
  for (const [agent, user] of [
    [own, owner],
    [client, clientA],
    [second, clientA],
    [other, clientB],
  ] as const)
    expect(
      (
        await mutate(agent, 'post', '/api/auth/login', {
          email: user.email,
          password,
        })
      ).status,
    ).toBe(200)
}, 30000)
afterAll(async () => {
  if (serverA)
    await new Promise<void>((resolve) => serverA.close(() => resolve()))
  if (serverB)
    await new Promise<void>((resolve) => serverB.close(() => resolve()))
  a.store.close()
  b.store.close()
  const orgIds = [orgA, orgB].filter(Boolean)
  // Only this run's generated records; never reset or truncate a database.
  await dbA.$transaction(async (tx) => {
    const versions = await tx.proposalVersion.findMany({
      where: { organizationId: { in: orgIds } },
      select: { id: true },
    })
    await tx.activityEvent.deleteMany({
      where: { organizationId: { in: orgIds } },
    })
    await tx.project.deleteMany({ where: { organizationId: { in: orgIds } } })
    await tx.proposalDecision.deleteMany({
      where: { versionId: { in: versions.map((v) => v.id) } },
    })
    await tx.proposal.updateMany({
      where: { organizationId: { in: orgIds } },
      data: { publishedVersionId: null },
    })
    await tx.proposalVersion.deleteMany({
      where: { organizationId: { in: orgIds } },
    })
    await tx.proposal.deleteMany({ where: { organizationId: { in: orgIds } } })
    await tx.membership.deleteMany({
      where: { organizationId: { in: orgIds } },
    })
    await tx.organization.deleteMany({ where: { id: { in: orgIds } } })
    await tx.user.deleteMany({
      where: { email: { endsWith: `-${tag}@example.test` } },
    })
  })
  await dbA.session.deleteMany({ where: { sid: { in: [...sessions] } } })
  const keys = ['127.0.0.1', '::ffff:127.0.0.1', '::1'].map((ip) =>
    createHmac('sha256', secret).update(`login:${ip}`).digest('hex'),
  )
  await dbA.authThrottle.deleteMany({ where: { key: { in: keys } } })
  await Promise.all([
    poolA.end(),
    poolB.end(),
    dbA.$disconnect(),
    dbB.$disconnect(),
  ])
})
describe('versioned proposals and scoped reads', () => {
  it('hides drafts and internal notes, scopes published versions, and rejects nested relation swaps', async () => {
    const p = await create()
    expect((await client.get(`${base()}/${p.proposalId}`)).status).toBe(404)
    expect((await client.get(base())).body.proposals).toEqual([])
    expect((await mutate(client, 'post', base(), draft())).status).toBe(403)
    expect((await send(p)).status).toBe(200)
    const published = await read(p, client)
    expect(published.versions[0]!.totalMinor).toBe('3500000')
    expect(published.versions[0]!.items[1]!.unitPriceMinor).toBe('0')
    expect(JSON.stringify(published)).not.toContain('OWNER PRIVATE')
    expect(published.versions[0]!.internalNotes).toBeUndefined()
    expect((await other.get(`${base()}/${p.proposalId}`)).status).toBe(404)
    expect((await client.get(`${base(orgB)}/${p.proposalId}`)).status).toBe(404)
    expect(
      (
        await mutate(
          own,
          'post',
          `${base(orgB)}/${p.proposalId}/versions/${p.versionId}/send`,
          { expectedRevision: 0 },
        )
      ).status,
    ).toBe(404)
    const otherProposal = await create('Other proposal')
    expect(
      (
        await mutate(
          own,
          'patch',
          `${base()}/${p.proposalId}/versions/${otherProposal.versionId}`,
          { ...draft(), expectedRevision: 0 },
        )
      ).status,
    ).toBe(404)
  })
  it('recomputes exact server totals, rejects forged totals, and detects stale draft saves', async () => {
    expect(
      (await mutate(own, 'post', base(), { ...draft(), totalMinor: '1' }))
        .status,
    ).toBe(400)
    const p = await create()
    const input = {
      ...draft(),
      items: [
        {
          description: 'Exact high value',
          quantity: 10000,
          unitPriceMinor: '999999999999',
        },
      ],
    }
    expect(
      (
        await mutate(
          own,
          'patch',
          `${base()}/${p.proposalId}/versions/${p.versionId}`,
          { ...input, expectedRevision: 0 },
        )
      ).status,
    ).toBe(200)
    expect((await read(p)).versions[0]!.totalMinor).toBe('9999999999990000')
    expect(
      (
        await mutate(
          own,
          'patch',
          `${base()}/${p.proposalId}/versions/${p.versionId}`,
          { ...draft(), expectedRevision: 0 },
        )
      ).status,
    ).toBe(409)
    expect((await send(p)).status).toBe(409)
    expect((await send(p, 1)).status).toBe(200)
  })
  it('protects sent snapshots and line items in both API and database', async () => {
    const p = await create()
    expect((await send(p)).status).toBe(200)
    expect(
      (
        await mutate(
          own,
          'patch',
          `${base()}/${p.proposalId}/versions/${p.versionId}`,
          { ...draft('Tampered'), expectedRevision: 0 },
        )
      ).status,
    ).toBe(409)
    await expect(
      dbA.proposalVersion.update({
        where: { id: p.versionId },
        data: { scope: 'Tampered' },
      }),
    ).rejects.toThrow()
    await expect(
      dbA.proposalVersion.update({
        where: { id: p.versionId },
        data: {
          items: [{ description: 'Changed', quantity: 1, unitPriceMinor: '0' }],
          totalMinor: 0n,
        },
      }),
    ).rejects.toThrow()
    expect((await read(p)).versions[0]!.scope).toBe('Five-page website')
  })
  it('preserves the sent version while drafting, then atomically supersedes on publish', async () => {
    const p = await create()
    await send(p)
    const revision = await mutate(
      own,
      'post',
      `${base()}/${p.proposalId}/versions`,
    )
    expect(revision.status).toBe(201)
    const draftVersion = revision.body.versionId as string
    expect((await read(p, client)).versions.map((v) => v.id)).toEqual([
      p.versionId,
    ])
    expect((await read(p, client)).publishedVersionId).toBe(p.versionId)
    expect(
      (
        await mutate(
          own,
          'post',
          `${base()}/${p.proposalId}/versions/${draftVersion}/send`,
          { expectedRevision: 0 },
        )
      ).status,
    ).toBe(200)
    const state = await read(p, client)
    expect(state.publishedVersionId).toBe(draftVersion)
    expect(state.versions.map((v) => v.state)).toEqual(['SENT', 'SUPERSEDED'])
    expect((await decide(client, p)).status).toBe(409)
    expect(
      await dbA.project.count({ where: { proposalId: p.proposalId } }),
    ).toBe(0)
  })
})
describe('decisions, projects and transaction invariants', () => {
  it('creates one planned project, records actor/time, and returns the same receipt on retries', async () => {
    const p = await create()
    await send(p)
    const result = await decide(client, p)
    expect(result.status).toBe(200)
    expect(result.body.decision.actor.id).toBe(clientA.id)
    expect(new Date(result.body.decision.createdAt).getTime()).toBeGreaterThan(
      0,
    )
    const again = await decide(second, p)
    expect(again.body).toEqual(result.body)
    expect((await decide(client, p, 'DECLINED')).status).toBe(409)
    const project = await client.get(
      `/api/organizations/${orgA}/projects/${result.body.projectId}`,
    )
    expect(project.status).toBe(200)
    expect(project.body.project).toMatchObject({
      organizationId: orgA,
      proposalId: p.proposalId,
      status: 'PLANNED',
    })
    expect(project.body.project.approvedVersion.id).toBe(p.versionId)
    expect(project.body.project.approvedVersion.internalNotes).toBeUndefined()
    expect(
      (
        await other.get(
          `/api/organizations/${orgA}/projects/${result.body.projectId}`,
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await own.get(
          `/api/organizations/${orgB}/projects/${result.body.projectId}`,
        )
      ).status,
    ).toBe(404)
    expect(
      (await mutate(own, 'post', `${base()}/${p.proposalId}/versions`)).status,
    ).toBe(409)
    await expect(
      dbA.project.create({
        data: {
          organizationId: orgA,
          proposalId: p.proposalId,
          approvedVersionId: p.versionId,
        },
      }),
    ).rejects.toThrow()
    expect(
      await dbA.project.count({ where: { proposalId: p.proposalId } }),
    ).toBe(1)
    expect(
      await dbA.activityEvent.count({
        where: { kind: 'PROPOSAL_DECIDED', targetId: p.versionId },
      }),
    ).toBe(1)
    expect(
      await dbA.activityEvent.count({
        where: { kind: 'PROJECT_CREATED', targetId: result.body.projectId },
      }),
    ).toBe(1)
  })
  it('declines without creating a project and permits a later draft revision', async () => {
    const p = await create()
    await send(p)
    const result = await decide(client, p, 'DECLINED')
    expect(result.status).toBe(200)
    expect(result.body.projectId).toBeNull()
    expect((await decide(second, p, 'DECLINED')).body).toEqual(result.body)
    expect(
      await dbA.project.count({ where: { proposalId: p.proposalId } }),
    ).toBe(0)
    expect(
      (await mutate(own, 'post', `${base()}/${p.proposalId}/versions`)).status,
    ).toBe(201)
  })
  it('rejects owner decisions, draft decisions, missing CSRF, and revoked membership reads/writes', async () => {
    const p = await create()
    expect((await decide(client, p)).status).toBe(404)
    await send(p)
    expect((await decide(own, p)).status).toBe(403)
    expect(
      (
        await client
          .post(`${base()}/${p.proposalId}/versions/${p.versionId}/decision`)
          .set('Origin', origin)
          .send({ outcome: 'APPROVED' })
      ).status,
    ).toBe(403)
    const membership = await dbA.membership.findUniqueOrThrow({
      where: {
        organizationId_userId: { organizationId: orgA, userId: clientA.id },
      },
    })
    await dbA.membership.update({
      where: { id: membership.id },
      data: { revokedAt: new Date() },
    })
    try {
      expect((await client.get(`${base()}/${p.proposalId}`)).status).toBe(404)
      expect((await decide(client, p)).status).toBe(404)
    } finally {
      await dbA.membership.update({
        where: { id: membership.id },
        data: { revokedAt: null },
      })
    }
  })
  it('rechecks a revocation committed while an approval waits for its organization lock', async () => {
    const p = await create()
    await send(p)
    const coordinator = await poolA.connect()
    let pending: Promise<request.Response> | undefined
    try {
      await coordinator.query('BEGIN')
      await coordinator.query(
        'SELECT id FROM organizations WHERE id = $1 FOR UPDATE',
        [orgA],
      )
      await coordinator.query(
        'UPDATE memberships SET revoked_at = now() WHERE organization_id = $1 AND user_id = $2',
        [orgA, clientA.id],
      )
      pending = decide(second, p)
      let blocked = false
      for (let i = 0; i < 200; i++) {
        const rows = await poolB.query<{ count: string }>(
          "SELECT count(*) FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
          [`jcb-proposal-b-${tag}`],
        )
        if (Number(rows.rows[0]!.count) > 0) {
          blocked = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      await coordinator.query('COMMIT')
      expect(blocked).toBe(true)
      expect((await pending).status).toBe(404)
      expect(
        await dbA.proposalDecision.count({ where: { versionId: p.versionId } }),
      ).toBe(0)
      expect(
        await dbA.project.count({ where: { proposalId: p.proposalId } }),
      ).toBe(0)
    } finally {
      await coordinator.query('ROLLBACK')
      coordinator.release()
      if (pending) await pending
      await dbA.membership.update({
        where: {
          organizationId_userId: { organizationId: orgA, userId: clientA.id },
        },
        data: { revokedAt: null },
      })
    }
  })
  it('handles concurrent same-outcome approvals on separate connections without duplicate projects', async () => {
    const p = await create()
    await send(p)
    const [first, repeat] = await contend([
      () => decide(client, p),
      () => decide(second, p),
    ])
    if (!first || !repeat) throw new Error('Missing concurrent response')
    expect([first.status, repeat.status]).toEqual([200, 200])
    expect(first.body).toEqual(repeat.body)
    expect(
      await dbA.project.count({ where: { proposalId: p.proposalId } }),
    ).toBe(1)
    expect(
      await dbA.proposalDecision.count({ where: { versionId: p.versionId } }),
    ).toBe(1)
    expect(
      await dbA.activityEvent.count({
        where: { kind: 'PROPOSAL_DECIDED', targetId: p.versionId },
      }),
    ).toBe(1)
  })
  it('serializes conflicting approve/decline decisions with one consistent outcome', async () => {
    const p = await create()
    await send(p)
    const results = await contend([
      () => decide(client, p),
      () => decide(second, p, 'DECLINED'),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const decision = await dbA.proposalDecision.findUniqueOrThrow({
      where: { versionId: p.versionId },
    })
    expect(
      (
        await dbA.proposalVersion.findUniqueOrThrow({
          where: { id: p.versionId },
        })
      ).state,
    ).toBe(decision.outcome)
    expect(
      await dbA.project.count({ where: { proposalId: p.proposalId } }),
    ).toBe(decision.outcome === 'APPROVED' ? 1 : 0)
    expect(
      await dbA.activityEvent.count({
        where: { kind: 'PROPOSAL_DECIDED', targetId: p.versionId },
      }),
    ).toBe(1)
  })
  it('serializes approve/supersede with either the old approval or the replacement sent', async () => {
    const p = await create()
    await send(p)
    const revision = await mutate(
      own,
      'post',
      `${base()}/${p.proposalId}/versions`,
    )
    const replacement = {
      proposalId: p.proposalId,
      versionId: revision.body.versionId as string,
    }
    const results = await contend([
      () => decide(second, p),
      () => send(replacement),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const state = await read(p),
      decisions = await dbA.proposalDecision.count({
        where: { versionId: p.versionId },
      }),
      projects = await dbA.project.count({
        where: { proposalId: p.proposalId },
      })
    if (state.approved) {
      expect(state.publishedVersionId).toBe(p.versionId)
      expect(decisions).toBe(1)
      expect(projects).toBe(1)
      expect(
        state.versions.find((v) => v.id === replacement.versionId)!.state,
      ).toBe('DRAFT')
    } else {
      expect(state.publishedVersionId).toBe(replacement.versionId)
      expect(decisions).toBe(0)
      expect(projects).toBe(0)
      expect(state.versions.find((v) => v.id === p.versionId)!.state).toBe(
        'SUPERSEDED',
      )
    }
    const supersededEvents = await dbA.activityEvent.count({
      where: { kind: 'PROPOSAL_SUPERSEDED', targetId: p.versionId },
    })
    const decisionEvents = await dbA.activityEvent.count({
      where: { kind: 'PROPOSAL_DECIDED', targetId: p.versionId },
    })
    expect(supersededEvents).toBe(state.approved ? 0 : 1)
    expect(decisionEvents).toBe(state.approved ? 1 : 0)
  })
  it('rejects wrong organization/proposal/version project references with database guards', async () => {
    const p = await create()
    await send(p)
    await decide(client, p)
    const otherProposal = await create('Different reference')
    await expect(
      dbA.project.create({
        data: {
          organizationId: orgB,
          proposalId: otherProposal.proposalId,
          approvedVersionId: p.versionId,
        },
      }),
    ).rejects.toThrow()
    await expect(
      dbA.proposal.update({
        where: { id: otherProposal.proposalId },
        data: { publishedVersionId: p.versionId },
      }),
    ).rejects.toThrow()
  })
  it('rolls back version state, decision, project and activity when the final activity write fails', async () => {
    const p = await create()
    await send(p)
    const name = `qa_fail_${tag.replaceAll('-', '')}`
    await dbA.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected activity failure'; END $$`,
    )
    await dbA.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON activity_events FOR EACH ROW WHEN (NEW.target_id = '${p.versionId}'::uuid AND NEW.kind = 'PROPOSAL_DECIDED') EXECUTE FUNCTION ${name}()`,
    )
    try {
      expect((await decide(client, p)).status).toBe(500)
      expect(
        (
          await dbA.proposalVersion.findUniqueOrThrow({
            where: { id: p.versionId },
          })
        ).state,
      ).toBe('SENT')
      expect(
        await dbA.proposalDecision.count({ where: { versionId: p.versionId } }),
      ).toBe(0)
      expect(
        await dbA.project.count({ where: { proposalId: p.proposalId } }),
      ).toBe(0)
      expect(
        await dbA.activityEvent.count({
          where: { kind: 'PROPOSAL_DECIDED', targetId: p.versionId },
        }),
      ).toBe(0)
      await dbA.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Injected serialization failure'; END $$`,
      )
      const exhausted = await decide(client, p)
      expect(exhausted.status).toBe(409)
      expect(exhausted.body.error.code).toBe('RETRY_REQUIRED')
      expect(
        await dbA.proposalDecision.count({ where: { versionId: p.versionId } }),
      ).toBe(0)
      expect(
        await dbA.project.count({ where: { proposalId: p.proposalId } }),
      ).toBe(0)
    } finally {
      await dbA.$executeRawUnsafe(`DROP TRIGGER ${name} ON activity_events`)
      await dbA.$executeRawUnsafe(`DROP FUNCTION ${name}()`)
    }
    expect((await decide(client, p)).status).toBe(200)
  })
})

describe('proposal HTTP payload boundaries', () => {
  it.each(['unicode', 'escaped', 'worst-case'])(
    'creates and updates maximum proposal content (%s)',
    async (encoding) => {
      const text = (length: number) =>
        (encoding === 'worst-case' ? '\u0001' : '漢😀\u0001"\\')
          .repeat(length)
          .slice(0, length - 1) + 'x'
      const input = {
        title: text(120),
        scope: text(12000),
        exclusions: text(12000),
        deliveryAssumptions: text(12000),
        internalNotes: text(4000),
        currency: 'PHP',
        items: Array.from({ length: 100 }, () => ({
          description: text(500),
          quantity: 1000,
          unitPriceMinor: '1000000000000',
        })),
      }
      const wire = (body: object) => {
        const json = JSON.stringify(body)
        return encoding === 'escaped'
          ? json.replace(
              /[\u007f-\uffff]/g,
              (v) => '\\u' + v.charCodeAt(0).toString(16).padStart(4, '0'),
            )
          : json
      }
      const token = await csrf(own)
      expect(Buffer.byteLength(wire(input))).toBeGreaterThan(16 * 1024)
      const created = await own
        .post(base())
        .set('Origin', origin)
        .set('X-CSRF-Token', token)
        .type('json')
        .send(wire(input))
      expect(created.status).toBe(201)
      const path = `${base()}/${created.body.proposalId}/versions/${created.body.versionId}`
      const updated = await own
        .patch(path)
        .set('Origin', origin)
        .set('X-CSRF-Token', token)
        .type('json')
        .send(
          wire({
            ...input,
            title: 'Updated ' + text(112),
            expectedRevision: 0,
          }),
        )
      expect(updated.status).toBe(200)
      const stored = await read(created.body)
      expect(stored.versions[0]!.scope).toBe(input.scope)
      expect(stored.versions[0]!.items).toEqual(input.items)
      expect(stored.versions[0]!.totalMinor).toBe('100000000000000000')
    },
  )
})
