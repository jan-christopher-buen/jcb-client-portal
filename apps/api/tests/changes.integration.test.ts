import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { once } from 'node:events'
import { randomUUID, createHmac } from 'node:crypto'
import { Pool } from 'pg'
import type { Server } from 'node:http'
import type {
  Identity,
  ProposalDraft,
  ChangeDetailDto,
  ChangeListDto,
  ChangeOfferInput,
} from '@jcb/contracts'
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
  value.searchParams.set('application_name', `jcb-change-${side}-${tag}`)
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
let own: Agent, client: Agent, second: Agent, other: Agent, ownSecond: Agent
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
        [[`jcb-change-a-${tag}`, `jcb-change-b-${tag}`]],
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
      name: 'Change owner',
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
  ownSecond = request.agent(serverB)
  for (const [agent, user] of [
    [own, owner],
    [client, clientA],
    [second, clientA],
    [other, clientB],
    [ownSecond, owner],
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
    const requests = await tx.changeRequest.findMany({
      where: { organizationId: { in: orgIds } },
      select: { id: true },
    })
    const requestIds = requests.map((r) => r.id)
    await tx.changeMessage.deleteMany({
      where: { requestId: { in: requestIds } },
    })
    await tx.changeDecision.deleteMany({
      where: { offer: { requestId: { in: requestIds } } },
    })
    await tx.changeRequest.updateMany({
      where: { id: { in: requestIds } },
      data: { publishedOfferId: null },
    })
    await tx.changeOffer.deleteMany({
      where: { requestId: { in: requestIds } },
    })
    await tx.changeRequest.deleteMany({ where: { id: { in: requestIds } } })
    await tx.workflowEvent.deleteMany({
      where: { organizationId: { in: orgIds } },
    })
    await tx.milestone.deleteMany({ where: { organizationId: { in: orgIds } } })
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
const changeBase = (pid: string, org = orgA) =>
  `/api/organizations/${org}/projects/${pid}/changes`
async function project() {
  const p = await create()
  expect((await send(p)).status).toBe(200)
  const r = await decide(client, p)
  expect(r.status).toBe(200)
  return r.body.projectId as string
}
async function requestChange(pid: string, title = 'Booking integration') {
  const r = await mutate(client, 'post', changeBase(pid), {
    title,
    requestedChange: 'Add booking integration to the website.',
    businessContext: 'Reduce manual appointment handling.',
  })
  expect(r.status).toBe(201)
  return r.body.requestId as string
}
async function detail(pid: string, rid: string, agent = own) {
  const r = await agent.get(`${changeBase(pid)}/${rid}`)
  expect(r.status).toBe(200)
  return r.body as ChangeDetailDto
}
async function amounts(pid: string, agent = client) {
  const r = await agent.get(changeBase(pid))
  expect(r.status).toBe(200)
  return r.body as ChangeListDto
}
const offerInput = (price = '250000'): ChangeOfferInput => ({
  scope: 'Booking integration including confirmation copy.',
  exclusions: 'Paid booking subscription.',
  adjustmentMinor: price,
  scheduleImpact:
    'Two additional business days. Owner must separately update milestone dates.',
})
async function draftOffer(pid: string, rid: string, price = '250000') {
  const current = await detail(pid, rid)
  const r = await mutate(own, 'post', `${changeBase(pid)}/${rid}/offers`, {
    expectedRevision: current.request.revision,
  })
  expect(r.status).toBe(201)
  const oid = r.body.offerId as string
  expect(
    (
      await mutate(own, 'patch', `${changeBase(pid)}/${rid}/offers/${oid}`, {
        ...offerInput(price),
        expectedRevision: 0,
      })
    ).status,
  ).toBe(200)
  return oid
}
async function publish(pid: string, rid: string, oid: string, agent = own) {
  const o = (await detail(pid, rid)).request.offers.find((o) => o.id === oid)!
  return mutate(
    agent,
    'post',
    `${changeBase(pid)}/${rid}/offers/${oid}/publish`,
    { expectedRevision: o.revision },
  )
}
async function offered(pid: string, price = '250000') {
  const rid = await requestChange(pid),
    oid = await draftOffer(pid, rid, price)
  expect((await publish(pid, rid, oid)).status).toBe(200)
  return { rid, oid }
}
async function decision(
  pid: string,
  rid: string,
  oid: string,
  outcome = 'APPROVED',
  agent = client,
) {
  return mutate(
    agent,
    'post',
    `${changeBase(pid)}/${rid}/offers/${oid}/decision`,
    { outcome },
  )
}
async function message(
  pid: string,
  rid: string,
  kind: string,
  body: string,
  agent = own,
) {
  const r = (await detail(pid, rid)).request
  return mutate(agent, 'post', `${changeBase(pid)}/${rid}/messages`, {
    kind,
    body,
    expectedRevision: r.revision,
  })
}
async function implement(
  pid: string,
  rid: string,
  note = 'Integrated booking and verified copy.',
  agent = own,
) {
  const r = (await detail(pid, rid)).request
  return mutate(agent, 'post', `${changeBase(pid)}/${rid}/implement`, {
    note,
    expectedRevision: r.revision,
  })
}
async function projectStatus(
  pid: string,
  action: string,
  reason = 'Workflow test reason',
  agent = own,
) {
  const p = (await amounts(pid)).project
  return mutate(
    agent,
    'post',
    `/api/organizations/${orgA}/projects/${pid}/status`,
    { action, reason, expectedRevision: p.revision },
  )
}
describe('versioned project change requests', () => {
  it('preserves clarification discussion, authorizes roles, hides owner notes and drafts', async () => {
    const pid = await project(),
      rid = await requestChange(pid)
    expect(
      (await message(pid, rid, 'RESPONSE', 'Before clarification', client))
        .status,
    ).toBe(409)
    expect((await message(pid, rid, 'CLARIFICATION', ' ')).status).toBe(400)
    expect(
      (await message(pid, rid, 'OWNER_NOTE', 'Client note', client)).status,
    ).toBe(403)
    expect(
      (
        await message(
          pid,
          rid,
          'CLARIFICATION',
          'Client pretending owner',
          client,
        )
      ).status,
    ).toBe(403)
    expect(
      (await message(pid, rid, 'RESPONSE', 'Owner pretending client')).status,
    ).toBe(403)
    expect(
      (await message(pid, rid, 'CLARIFICATION', 'Which booking provider?'))
        .status,
    ).toBe(201)
    expect((await detail(pid, rid, client)).request.state).toBe(
      'NEEDS_CLARIFICATION',
    )
    const oid = await draftOffer(pid, rid)
    expect((await publish(pid, rid, oid)).status).toBe(409)
    expect(
      (await message(pid, rid, 'OWNER_NOTE', 'PRIVATE NEGOTIATION STRATEGY'))
        .status,
    ).toBe(201)
    expect(
      (
        await message(
          pid,
          rid,
          'RESPONSE',
          'Use the existing provider.',
          client,
        )
      ).status,
    ).toBe(201)
    const visible = await detail(pid, rid, client),
      ownerView = await detail(pid, rid)
    expect(visible.request.state).toBe('OPEN')
    expect(visible.request.offers).toEqual([])
    expect(visible.request.messages.map((m) => m.kind)).toEqual([
      'CLARIFICATION',
      'RESPONSE',
    ])
    expect(JSON.stringify(visible)).not.toContain('PRIVATE NEGOTIATION')
    expect(ownerView.request.messages).toHaveLength(3)
    expect((await decision(pid, rid, oid)).status).toBe(404)
    const note = await dbA.changeMessage.findFirstOrThrow({
      where: { requestId: rid, kind: 'OWNER_NOTE' },
    })
    expect(
      await dbA.activityEvent.count({ where: { targetId: note.id } }),
    ).toBe(0)
    await expect(
      dbA.changeMessage.update({
        where: { id: note.id },
        data: { body: 'rewrite' },
      }),
    ).rejects.toThrow()
  })
  it('validates exact signed adjustments, rejects bad inputs and isolates every nested relation', async () => {
    const pid = await project(),
      rid = await requestChange(pid),
      oid = await draftOffer(pid, rid)
    for (const price of ['-0', '1.5', '100000000000000001', 5])
      expect(
        (
          await mutate(
            own,
            'patch',
            `${changeBase(pid)}/${rid}/offers/${oid}`,
            { ...offerInput(), adjustmentMinor: price, expectedRevision: 1 },
          )
        ).status,
      ).toBe(400)
    expect(
      (
        await mutate(own, 'patch', `${changeBase(pid)}/${rid}/offers/${oid}`, {
          ...offerInput(),
          currency: 'USD',
          expectedRevision: 1,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await mutate(own, 'patch', `${changeBase(pid)}/${rid}/offers/${oid}`, {
          ...offerInput(),
          expectedRevision: 0,
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await mutate(own, 'post', changeBase(pid), {
          title: 'Owner request',
          requestedChange: 'x',
          businessContext: 'x',
        })
      ).status,
    ).toBe(403)
    expect((await other.get(changeBase(pid))).status).toBe(404)
    expect((await other.get(`${changeBase(pid)}/${rid}`)).status).toBe(404)
    expect((await client.get(`${changeBase(pid, orgB)}/${rid}`)).status).toBe(
      404,
    )
    const otherPid = await project(),
      otherRid = await requestChange(otherPid)
    expect((await own.get(`${changeBase(otherPid)}/${rid}`)).status).toBe(404)
    expect(
      (
        await mutate(
          own,
          'patch',
          `${changeBase(otherPid)}/${otherRid}/offers/${oid}`,
          { ...offerInput(), expectedRevision: 1 },
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await mutate(client, 'post', `${changeBase(pid)}/${rid}/offers`, {
          expectedRevision: 0,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await own
          .post(`${changeBase(pid)}/${rid}/offers/${oid}/publish`)
          .set('Origin', origin)
          .send({ expectedRevision: 1 })
      ).status,
    ).toBe(403)
    expect(
      (
        await own
          .post(`${changeBase(pid)}/${rid}/offers/${oid}/publish`)
          .set('Origin', 'https://foreign.example')
          .set('X-CSRF-Token', await csrf(own))
          .send({ expectedRevision: 1 })
      ).status,
    ).toBe(403)
  })
  it('approves exactly once, preserves proposal/dates, records implementation separately and locks approved content', async () => {
    const pid = await project(),
      { rid, oid } = await offered(pid, '-100001')
    const milestone = await mutate(
      own,
      'post',
      `/api/organizations/${orgA}/projects/${pid}/milestones`,
      {
        title: 'Existing date',
        description: 'Scope approval must not shift this due date.',
        dueDate: '2030-01-15',
        required: true,
        position: 1,
      },
    )
    expect(milestone.status).toBe(201)
    const projectBefore = await dbA.project.findUniqueOrThrow({
        where: { id: pid },
      }),
      sourceBefore = await dbA.proposalVersion.findUniqueOrThrow({
        where: { id: projectBefore.approvedVersionId },
      })
    const revisionDraft = await draftOffer(pid, rid, '999')
    const approval = await decision(pid, rid, oid)
    expect(approval.status).toBe(200)
    expect(approval.body.amounts).toMatchObject({
      originalMinor: '3500000',
      adjustmentsMinor: '-100001',
      revisedMinor: '3399999',
    })
    expect((await decision(pid, rid, oid)).body.decision).toEqual(
      approval.body.decision,
    )
    expect((await decision(pid, rid, oid, 'DECLINED')).status).toBe(409)
    expect((await publish(pid, rid, revisionDraft)).status).toBe(409)
    expect((await draftOfferAttempt(pid, rid)).status).toBe(409)
    expect(
      (
        await mutate(
          own,
          'patch',
          `${changeBase(pid)}/${rid}/offers/${revisionDraft}`,
          { ...offerInput(), expectedRevision: 1 },
        )
      ).status,
    ).toBe(409)
    await expect(
      dbA.changeOffer.update({
        where: { id: oid },
        data: { adjustmentMinor: 1n },
      }),
    ).rejects.toThrow()
    await expect(
      dbA.changeRequest.update({
        where: { id: rid },
        data: {
          state: 'IMPLEMENTED',
          implementedBy: owner.id,
          implementedAt: new Date(),
          implementationNote: null,
        },
      }),
    ).rejects.toThrow()
    expect((await implement(pid, rid, ' ')).status).toBe(400)
    expect((await implement(pid, rid, 'Pretend owner', client)).status).toBe(
      403,
    )
    expect((await implement(pid, rid)).status).toBe(200)
    expect((await implement(pid, rid)).status).toBe(409)
    const data = await detail(pid, rid, client)
    expect(data.request.state).toBe('IMPLEMENTED')
    expect(data.request.implementer!.id).toBe(owner.id)
    expect(data.request.offers[0]!.decision!.actor.id).toBe(clientA.id)
    expect(data.amounts.revisedMinor).toBe('3399999')
    expect(data.amounts.approvedChanges).toHaveLength(1)
    expect(
      await dbA.proposalVersion.findUniqueOrThrow({
        where: { id: projectBefore.approvedVersionId },
      }),
    ).toEqual(sourceBefore)
    expect(
      (await dbA.project.findUniqueOrThrow({ where: { id: pid } })).status,
    ).toBe(projectBefore.status)
    expect(
      (
        await dbA.milestone.findUniqueOrThrow({
          where: { id: milestone.body.milestoneId },
        })
      )
        .dueDate!.toISOString()
        .slice(0, 10),
    ).toBe('2030-01-15')
    expect(await dbA.changeDecision.count({ where: { offerId: oid } })).toBe(1)
    expect(
      await dbA.activityEvent.count({
        where: { targetId: rid, kind: 'CHANGE_IMPLEMENTED' },
      }),
    ).toBe(1)
  })
  it('keeps the current offer during drafting and atomically supersedes it on publication', async () => {
    const pid = await project(),
      { rid, oid } = await offered(pid),
      next = await draftOffer(pid, rid, '0')
    expect((await detail(pid, rid, client)).request.publishedOfferId).toBe(oid)
    expect(
      (await detail(pid, rid, client)).request.offers.map((o) => o.id),
    ).toEqual([oid])
    expect((await amounts(pid)).amounts.adjustmentsMinor).toBe('0')
    expect((await publish(pid, rid, next)).status).toBe(200)
    expect((await publish(pid, rid, next)).status).toBe(200)
    expect((await decision(pid, rid, oid)).status).toBe(409)
    const d = await detail(pid, rid, client)
    expect(d.request.publishedOfferId).toBe(next)
    expect(d.request.offers[1]!.state).toBe('SUPERSEDED')
    await expect(
      dbA.changeOffer.update({
        where: { id: oid },
        data: { scope: 'mutate sent scope' },
      }),
    ).rejects.toThrow()
    expect((await decision(pid, rid, next, 'APPROVED', own)).status).toBe(403)
    expect((await decision(pid, rid, next)).status).toBe(200)
    expect((await amounts(pid)).amounts).toMatchObject({
      adjustmentsMinor: '0',
      revisedMinor: '3500000',
    })
  })
  it('declines without affecting totals, permits a replacement and preserves the old receipt', async () => {
    const pid = await project(),
      { rid, oid } = await offered(pid)
    const decline = await decision(pid, rid, oid, 'DECLINED')
    expect(decline.status).toBe(200)
    expect((await decision(pid, rid, oid, 'DECLINED')).body.decision).toEqual(
      decline.body.decision,
    )
    expect((await amounts(pid)).amounts.approvedChanges).toEqual([])
    expect((await implement(pid, rid)).status).toBe(409)
    expect(
      (
        await message(
          pid,
          rid,
          'CLARIFICATION',
          'What should the replacement include?',
        )
      ).status,
    ).toBe(201)
    expect(
      (await message(pid, rid, 'RESPONSE', 'The reduced scope.', client))
        .status,
    ).toBe(201)
    const next = await draftOffer(pid, rid, '100')
    expect((await publish(pid, rid, next)).status).toBe(200)
    expect((await decision(pid, rid, oid, 'DECLINED')).status).toBe(409)
    expect((await decision(pid, rid, next)).status).toBe(200)
    expect(
      (await detail(pid, rid, client)).request.offers[1]!.decision,
    ).toEqual(decline.body.decision)
    expect((await amounts(pid)).amounts.revisedMinor).toBe('3500100')
  })
  it('rejects a negative revised amount transactionally and allows an exact zero agreement', async () => {
    const pid = await project(),
      { rid, oid } = await offered(pid, '-3500001')
    const before = await amounts(pid)
    const result = await decision(pid, rid, oid)
    expect(result.status).toBe(409)
    expect(result.body.error.code).toBe('AGREED_AMOUNT_BOUNDS')
    expect((await amounts(pid)).amounts).toEqual(before.amounts)
    expect(await dbA.changeDecision.count({ where: { offerId: oid } })).toBe(0)
    expect((await detail(pid, rid)).request.offers[0]!.state).toBe('PUBLISHED')
    const next = await draftOffer(pid, rid, '-3500000')
    expect((await publish(pid, rid, next)).status).toBe(200)
    expect((await decision(pid, rid, next)).status).toBe(200)
    expect((await amounts(pid)).amounts.revisedMinor).toBe('0')
  })
  it('returns one receipt for overlapping identical decisions without double-counting', async () => {
    const pid = await project(),
      { rid, oid } = await offered(pid)
    const results = await contend([
      () => decision(pid, rid, oid),
      () => decision(pid, rid, oid, 'APPROVED', second),
    ])
    expect(results.map((r) => r.status)).toEqual([200, 200])
    expect(results[0]!.body.decision).toEqual(results[1]!.body.decision)
    expect((await amounts(pid)).amounts.revisedMinor).toBe('3750000')
    expect(await dbA.changeDecision.count({ where: { offerId: oid } })).toBe(1)
    expect(
      await dbA.activityEvent.count({
        where: { targetId: oid, kind: 'CHANGE_DECIDED' },
      }),
    ).toBe(1)
  })
  it('coordinates conflicting decisions and approval versus replacement publication', async () => {
    const pid = await project(),
      first = await offered(pid)
    const conflict = await contend([
      () => decision(pid, first.rid, first.oid),
      () => decision(pid, first.rid, first.oid, 'DECLINED', second),
    ])
    expect(conflict.map((r) => r.status).sort()).toEqual([200, 409])
    const saved = await detail(pid, first.rid)
    expect(saved.amounts.approvedChanges).toHaveLength(
      saved.request.state === 'APPROVED' ? 1 : 0,
    )
    const otherRequest = await offered(pid),
      next = await draftOffer(pid, otherRequest.rid, '9999')
    const result = await contend([
      () => decision(pid, otherRequest.rid, otherRequest.oid),
      () => publish(pid, otherRequest.rid, next, ownSecond),
    ])
    expect(result.map((r) => r.status).sort()).toEqual([200, 409])
    const data = await detail(pid, otherRequest.rid)
    if (result[0]!.status === 200) {
      expect(data.request.state).toBe('APPROVED')
      expect(data.request.publishedOfferId).toBe(otherRequest.oid)
    } else {
      expect(data.request.state).toBe('OFFERED')
      expect(data.request.publishedOfferId).toBe(next)
      expect(
        data.request.offers.find((o) => o.id === otherRequest.oid)!.state,
      ).toBe('SUPERSEDED')
    }
  })
  it('serializes approvals on DIFFERENT requests to preserve lower and upper aggregate bounds', async () => {
    for (const adjustment of ['-2000000', '50000000000000000']) {
      const pid = await project(),
        one = await offered(pid, adjustment),
        two = await offered(pid, adjustment)
      const results = await contend([
        () => decision(pid, one.rid, one.oid),
        () => decision(pid, two.rid, two.oid, 'APPROVED', second),
      ])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409])
      const total = (await amounts(pid)).amounts
      expect(total.approvedChanges).toHaveLength(1)
      expect(total.revisedMinor).toBe(
        (3500000n + BigInt(adjustment)).toString(),
      )
      expect(
        await dbA.changeDecision.count({
          where: { offerId: { in: [one.oid, two.oid] } },
        }),
      ).toBe(1)
    }
  })
  it('blocks held/cancelled workflows, retains reads and rejects revoked members', async () => {
    const pid = await project(),
      pending = await offered(pid),
      approved = await offered(pid)
    expect((await decision(pid, approved.rid, approved.oid)).status).toBe(200)
    expect((await projectStatus(pid, 'HOLD')).status).toBe(200)
    expect((await decision(pid, pending.rid, pending.oid)).status).toBe(409)
    expect((await implement(pid, approved.rid)).status).toBe(409)
    expect(
      (await message(pid, pending.rid, 'OWNER_NOTE', 'Held note')).status,
    ).toBe(409)
    expect((await draftOfferAttempt(pid, pending.rid)).status).toBe(409)
    expect(
      (
        await mutate(client, 'post', changeBase(pid), {
          title: 'held',
          requestedChange: 'held',
          businessContext: 'held',
        })
      ).status,
    ).toBe(409)
    expect((await detail(pid, pending.rid, client)).project.status).toBe(
      'ON_HOLD',
    )
    expect((await projectStatus(pid, 'RESUME')).status).toBe(200)
    await dbA.membership.update({
      where: {
        organizationId_userId: { organizationId: orgA, userId: clientA.id },
      },
      data: { revokedAt: new Date() },
    })
    try {
      expect(
        (await client.get(`${changeBase(pid)}/${pending.rid}`)).status,
      ).toBe(404)
      expect((await decision(pid, pending.rid, pending.oid)).status).toBe(404)
    } finally {
      await dbA.membership.update({
        where: {
          organizationId_userId: { organizationId: orgA, userId: clientA.id },
        },
        data: { revokedAt: null },
      })
    }
    expect((await projectStatus(pid, 'CANCEL')).status).toBe(200)
    expect((await decision(pid, pending.rid, pending.oid)).status).toBe(409)
    expect((await implement(pid, approved.rid)).status).toBe(409)
    expect((await detail(pid, pending.rid, client)).project.status).toBe(
      'CANCELLED',
    )
  })
  it('coordinates approval against hold and cancellation using the same project lock', async () => {
    for (const action of ['HOLD', 'CANCEL']) {
      const pid = await project(),
        { rid, oid } = await offered(pid),
        p = (await amounts(pid)).project
      const result = await contend([
        () => decision(pid, rid, oid),
        () =>
          mutate(
            ownSecond,
            'post',
            `/api/organizations/${orgA}/projects/${pid}/status`,
            { action, reason: 'Race test', expectedRevision: p.revision },
          ),
      ])
      expect(result.map((r) => r.status).sort()).toEqual([200, 409])
      const data = await detail(pid, rid)
      if (result[0]!.status === 200) {
        expect(data.project.status).toBe('PLANNED')
        expect(data.request.state).toBe('APPROVED')
      } else {
        expect(data.project.status).toBe(
          action === 'HOLD' ? 'ON_HOLD' : 'CANCELLED',
        )
        expect(data.request.state).toBe('OFFERED')
        expect(data.amounts.approvedChanges).toHaveLength(0)
      }
    }
  })
  it('rechecks membership revoked while approval waits for its lock', async () => {
    const pid = await project(),
      { rid, oid } = await offered(pid),
      coordinator = await poolA.connect()
    let pending: Promise<request.Response> | undefined
    try {
      await coordinator.query('BEGIN')
      await coordinator.query(
        'SELECT id FROM organizations WHERE id=$1 FOR UPDATE',
        [orgA],
      )
      await coordinator.query(
        'UPDATE memberships SET revoked_at=now() WHERE organization_id=$1 AND user_id=$2',
        [orgA, clientA.id],
      )
      pending = decision(pid, rid, oid, 'APPROVED', second)
      let blocked = false
      for (let i = 0; i < 200; i++) {
        const count = await poolB.query<{ count: string }>(
          "SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
          [`jcb-change-b-${tag}`],
        )
        if (Number(count.rows[0]!.count) > 0) {
          blocked = true
          break
        }
        await new Promise((r) => setTimeout(r, 10))
      }
      await coordinator.query('COMMIT')
      expect(blocked).toBe(true)
      expect((await pending).status).toBe(404)
      expect(await dbA.changeDecision.count({ where: { offerId: oid } })).toBe(
        0,
      )
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
  it('rolls back decision, totals and activity together, and rolls back implementation history on failure', async () => {
    const pid = await project(),
      { rid, oid } = await offered(pid),
      before = await detail(pid, rid),
      name = `qa_change_${tag.replaceAll('-', '')}`
    await dbA.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.target_id IN ('${oid}'::uuid,'${rid}'::uuid) AND NEW.kind::text IN ('CHANGE_DECIDED','CHANGE_IMPLEMENTED') THEN RAISE EXCEPTION 'Injected change activity failure'; END IF; RETURN NEW; END $$`,
    )
    await dbA.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    )
    try {
      expect((await decision(pid, rid, oid)).status).toBe(500)
      expect(await detail(pid, rid)).toEqual(before)
      expect(await dbA.changeDecision.count({ where: { offerId: oid } })).toBe(
        0,
      )
    } finally {
      await dbA.$executeRawUnsafe(`DROP TRIGGER ${name} ON activity_events`)
    }
    expect((await decision(pid, rid, oid)).status).toBe(200)
    const approved = await detail(pid, rid)
    await dbA.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    )
    try {
      expect((await implement(pid, rid)).status).toBe(500)
      expect(await detail(pid, rid)).toEqual(approved)
    } finally {
      await dbA.$executeRawUnsafe(`DROP TRIGGER ${name} ON activity_events`)
      await dbA.$executeRawUnsafe(`DROP FUNCTION ${name}()`)
    }
    expect((await implement(pid, rid)).status).toBe(200)
  })
})
async function draftOfferAttempt(pid: string, rid: string) {
  const r = (await detail(pid, rid)).request
  return mutate(own, 'post', `${changeBase(pid)}/${rid}/offers`, {
    expectedRevision: r.revision,
  })
}
