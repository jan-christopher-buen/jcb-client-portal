import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { once } from 'node:events'
import { randomUUID, createHmac } from 'node:crypto'
import { Pool } from 'pg'
import type { Server } from 'node:http'
import type {
  Identity,
  ProposalDraft,
  DeliverableDetailDto,
  HandoverDto,
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
  value.searchParams.set('application_name', `jcb-handover-${side}-${tag}`)
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
        [[`jcb-handover-a-${tag}`, `jcb-handover-b-${tag}`]],
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
    await tx.project.updateMany({
      where: { organizationId: { in: orgIds }, status: 'COMPLETED' },
      data: { status: 'IN_REVIEW', completedAt: null },
    })
    await tx.handoverEvent.deleteMany({
      where: { organizationId: { in: orgIds } },
    })
    await tx.projectCompletion.deleteMany({
      where: { organizationId: { in: orgIds } },
    })
    await tx.handoverItem.deleteMany({
      where: { organizationId: { in: orgIds } },
    })
    await tx.deliverableEvent.deleteMany({
      where: { organizationId: { in: orgIds } },
    })
    await tx.deliverableDecision.deleteMany({
      where: { version: { deliverable: { organizationId: { in: orgIds } } } },
    })
    await tx.deliverable.updateMany({
      where: { organizationId: { in: orgIds } },
      data: { currentVersionId: null },
    })
    await tx.deliverableVersion.deleteMany({
      where: { deliverable: { organizationId: { in: orgIds } } },
    })
    await tx.deliverable.deleteMany({
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
    await tx.milestone.updateMany({
      where: { organizationId: { in: orgIds } },
      data: { currentReviewId: null },
    })
    await tx.milestoneReview.deleteMany({
      where: { milestone: { organizationId: { in: orgIds } } },
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
const deliverableBase = (pid: string, org = orgA) =>
  `/api/organizations/${org}/projects/${pid}/deliverables`
const content = (title = 'Fictional website preview') => ({
  title,
  description: 'Plain text submitted work for review.',
  links: [
    { label: 'Public fictional example', url: 'https://example.com/demo' },
  ],
})
async function project() {
  const p = await create()
  expect((await send(p)).status).toBe(200)
  const r = await decide(client, p)
  expect(r.status).toBe(200)
  return r.body.projectId as string
}
async function deliverable(pid: string, position = 1) {
  const r = await mutate(own, 'post', deliverableBase(pid), {
    ...content(),
    required: true,
    position,
  })
  expect(r.status).toBe(201)
  return {
    did: r.body.deliverableId as string,
    vid: r.body.versionId as string,
  }
}
async function detail(pid: string, did: string, agent = own) {
  const r = await agent.get(`${deliverableBase(pid)}/${did}`)
  expect(r.status).toBe(200)
  return r.body as DeliverableDetailDto
}
async function publishBody(pid: string, did: string, vid: string, reason = '') {
  const d = (await detail(pid, did)).deliverable
  return {
    expectedRevision: d.versions.find((v) => v.id === vid)!.revision,
    expectedDeliverableRevision: d.revision,
    reason,
  }
}
async function publish(pid: string, did: string, vid: string, reason = '') {
  return mutate(
    own,
    'post',
    `${deliverableBase(pid)}/${did}/versions/${vid}/publish`,
    await publishBody(pid, did, vid, reason),
  )
}
async function published(pid: string) {
  const d = await deliverable(pid)
  expect((await publish(pid, d.did, d.vid)).status).toBe(200)
  return d
}
async function revision(pid: string, did: string) {
  const d = (await detail(pid, did)).deliverable
  const r = await mutate(
    own,
    'post',
    `${deliverableBase(pid)}/${did}/versions`,
    { expectedRevision: d.revision },
  )
  expect(r.status).toBe(201)
  return r.body.versionId as string
}
async function decision(
  pid: string,
  did: string,
  vid: string,
  outcome = 'ACCEPTED',
  agent = client,
  feedback = '',
) {
  return mutate(
    agent,
    'post',
    `${deliverableBase(pid)}/${did}/versions/${vid}/decision`,
    { outcome, feedback },
  )
}
async function withdraw(
  pid: string,
  did: string,
  vid: string,
  reason = 'Incorrect preview link',
) {
  return mutate(
    own,
    'post',
    `${deliverableBase(pid)}/${did}/versions/${vid}/withdraw`,
    { expectedRevision: (await detail(pid, did)).deliverable.revision, reason },
  )
}
async function status(pid: string, action: string, agent = own) {
  const d = await agent.get(deliverableBase(pid))
  return mutate(
    agent,
    'post',
    `/api/organizations/${orgA}/projects/${pid}/status`,
    {
      action,
      reason: 'Workflow test',
      expectedRevision: d.body.project.revision,
    },
  )
}
const projectBase = (pid: string, org = orgA) =>
  `/api/organizations/${org}/projects/${pid}`
async function handover(pid: string, agent = own, page = 1) {
  const r = await agent.get(`${projectBase(pid)}/handover?page=${page}`)
  expect(r.status).toBe(200)
  return r.body as HandoverDto
}
async function readiness(pid: string, agent = own) {
  const r = await agent.get(`${projectBase(pid)}/completion-readiness`)
  expect(r.status).toBe(200)
  return r.body as HandoverDto
}
async function item(
  pid: string,
  position = 1,
  required = true,
  clientVisible = true,
) {
  const r = await mutate(own, 'post', `${projectBase(pid)}/handover/items`, {
    title: `Handover task ${position}`,
    description: 'Confirm documentation was shared. No credentials.',
    required,
    clientVisible,
    position,
  })
  expect(r.status).toBe(201)
  return r.body.itemId as string
}
async function check(pid: string, iid: string, completed = true, agent = own) {
  const i = (await handover(pid)).items.find((i) => i.id === iid)!
  return mutate(
    agent,
    'post',
    `${projectBase(pid)}/handover/items/${iid}/check`,
    {
      completed,
      expectedRevision: i.revision,
      reason: completed
        ? 'Documentation sharing recorded.'
        : 'Checklist work must be repeated.',
    },
  )
}
async function milestone(pid: string, position = 1, accepted = true) {
  const r = await mutate(own, 'post', `${projectBase(pid)}/milestones`, {
    title: `Required milestone ${position}`,
    description: 'Text review',
    dueDate: null,
    required: true,
    position,
  })
  expect(r.status).toBe(201)
  const mid = r.body.milestoneId as string
  if (accepted) {
    expect(
      (
        await mutate(
          own,
          'post',
          `${projectBase(pid)}/milestones/${mid}/actions`,
          { action: 'START', expectedRevision: 0 },
        )
      ).status,
    ).toBe(200)
    const submitted = await mutate(
      own,
      'post',
      `${projectBase(pid)}/milestones/${mid}/actions`,
      { action: 'SUBMIT', expectedRevision: 1 },
    )
    expect(submitted.status).toBe(200)
    expect(
      (
        await mutate(
          client,
          'post',
          `${projectBase(pid)}/milestones/${mid}/reviews/${submitted.body.reviewId}/decision`,
          { outcome: 'ACCEPTED' },
        )
      ).status,
    ).toBe(200)
  }
  return mid
}
async function complete(pid: string, agent = own, expected?: number) {
  return mutate(agent, 'post', `${projectBase(pid)}/complete`, {
    confirm: true,
    expectedRevision: expected ?? (await handover(pid)).project.revision,
  })
}
async function ready() {
  const pid = await project(),
    mid = await milestone(pid),
    { did, vid } = await published(pid),
    iid = await item(pid)
  expect((await decision(pid, did, vid)).status).toBe(200)
  expect((await check(pid, iid)).status).toBe(200)
  expect((await status(pid, 'ACTIVATE')).status).toBe(200)
  expect((await status(pid, 'REVIEW')).status).toBe(200)
  expect((await readiness(pid)).ready).toBe(true)
  return { pid, mid, did, vid, iid }
}
async function reopen(
  pid: string,
  reason = 'Follow-up scope requires new closure.',
) {
  return mutate(own, 'post', `${projectBase(pid)}/reopen`, {
    reason,
    expectedRevision: (await handover(pid)).project.revision,
  })
}
async function reopenMilestone(pid: string, mid: string, agent = own) {
  const m = await dbA.milestone.findUniqueOrThrow({ where: { id: mid } })
  return mutate(
    agent,
    'post',
    `${projectBase(pid)}/milestones/${mid}/actions`,
    {
      action: 'REOPEN',
      reason: 'Need another review.',
      expectedRevision: m.revision,
    },
  )
}
async function change(pid: string) {
  const r = await mutate(client, 'post', `${projectBase(pid)}/changes`, {
    title: 'Scope addition',
    requestedChange: 'Additional copy.',
    businessContext: 'New page.',
  })
  expect(r.status).toBe(201)
  return r.body.requestId as string
}
async function changeDetail(pid: string, rid: string) {
  const r = await own.get(`${projectBase(pid)}/changes/${rid}`)
  expect(r.status).toBe(200)
  return r.body
}
async function offer(pid: string, rid: string) {
  const r = await mutate(
    own,
    'post',
    `${projectBase(pid)}/changes/${rid}/offers`,
    { expectedRevision: (await changeDetail(pid, rid)).request.revision },
  )
  expect(r.status).toBe(201)
  return r.body.offerId as string
}
async function offerPublish(pid: string, rid: string, oid: string) {
  return mutate(
    own,
    'post',
    `${projectBase(pid)}/changes/${rid}/offers/${oid}/publish`,
    { expectedRevision: 0 },
  )
}
async function changeDecision(
  pid: string,
  rid: string,
  oid: string,
  outcome = 'APPROVED',
) {
  return mutate(
    client,
    'post',
    `${projectBase(pid)}/changes/${rid}/offers/${oid}/decision`,
    { outcome },
  )
}
async function close(pid: string, rid: string) {
  return mutate(own, 'post', `${projectBase(pid)}/changes/${rid}/close`, {
    expectedRevision: (await changeDetail(pid, rid)).request.revision,
    reason: 'Request intentionally abandoned.',
  })
}
const codes = (d: HandoverDto) => d.blockers.map((b) => b.code)
describe(
  'authoritative handover and guarded completion',
  { timeout: 60000 },
  () => {
    it('reports every empty-set gate and rejects supplied readiness/snapshot overrides', async () => {
      const pid = await project(),
        r = await readiness(pid)
      expect(codes(r).sort()).toEqual(
        [
          'PROJECT_NOT_IN_REVIEW',
          'NO_REQUIRED_MILESTONES',
          'NO_REQUIRED_DELIVERABLES',
          'NO_REQUIRED_CHECKLIST',
        ].sort(),
      )
      expect((await complete(pid)).status).toBe(409)
      expect(
        (
          await mutate(own, 'post', `${projectBase(pid)}/complete`, {
            confirm: true,
            expectedRevision: r.project.revision,
            ready: true,
            snapshot: {},
          })
        ).status,
      ).toBe(400)
      expect(
        (
          await mutate(own, 'post', `${projectBase(pid)}/complete`, {
            confirm: false,
            expectedRevision: r.project.revision,
          })
        ).status,
      ).toBe(400)
    })
    it('independently blocks missing current milestone acceptance, deliverable acceptance and checklist completion', async () => {
      const { pid, mid, did, iid } = await ready()
      expect((await reopenMilestone(pid, mid)).status).toBe(200)
      expect(codes(await readiness(pid))).toEqual(['MILESTONE_NOT_ACCEPTED'])
      const next = await revision(pid, did)
      expect(
        (await publish(pid, did, next, 'Revised accepted work')).status,
      ).toBe(200)
      expect(codes(await readiness(pid)).sort()).toEqual(
        ['MILESTONE_NOT_ACCEPTED', 'DELIVERABLE_NOT_ACCEPTED'].sort(),
      )
      expect((await check(pid, iid, false)).status).toBe(200)
      expect(codes(await readiness(pid))).toContain('CHECKLIST_INCOMPLETE')
      expect((await withdraw(pid, did, next)).status).toBe(200)
      expect(codes(await readiness(pid))).toContain('DELIVERABLE_NOT_ACCEPTED')
      const fresh = await project()
      await milestone(fresh)
      await deliverable(fresh)
      await item(fresh)
      expect(
        (await readiness(fresh, client)).blockers.find(
          (b) => b.code === 'DELIVERABLE_NOT_ACCEPTED',
        )!.message,
      ).not.toContain('Fictional website preview')
      expect(codes(await readiness(fresh))).toContain(
        'DELIVERABLE_NOT_ACCEPTED',
      )
      expect((await complete(pid)).status).toBe(409)
    })
    it('requires In review independently and retains readable blockers when held/cancelled', async () => {
      const { pid } = await ready()
      expect((await status(pid, 'HOLD')).status).toBe(200)
      expect(codes(await readiness(pid))).toEqual(['PROJECT_NOT_IN_REVIEW'])
      expect((await complete(pid)).status).toBe(409)
      expect((await status(pid, 'RESUME')).status).toBe(200)
      expect((await readiness(pid)).ready).toBe(true)
      expect((await status(pid, 'CANCEL')).status).toBe(200)
      expect((await complete(pid)).status).toBe(409)
      expect((await readiness(pid, client)).ready).toBe(false)
    })
    it('defines change terminals: clarification/drafts/pending/approved work block; implemented, clean decline and explicit closure resolve', async () => {
      const { pid } = await ready(),
        rid = await change(pid)
      expect(codes(await readiness(pid))).toEqual(['CHANGE_UNRESOLVED'])
      expect(
        (
          await mutate(
            own,
            'post',
            `${projectBase(pid)}/changes/${rid}/messages`,
            { kind: 'CLARIFICATION', body: 'Which copy?', expectedRevision: 0 },
          )
        ).status,
      ).toBe(201)
      expect(codes(await readiness(pid))).toEqual(['CHANGE_UNRESOLVED'])
      expect(
        (
          await mutate(
            client,
            'post',
            `${projectBase(pid)}/changes/${rid}/messages`,
            { kind: 'RESPONSE', body: 'New copy.', expectedRevision: 1 },
          )
        ).status,
      ).toBe(201)
      const oid = await offer(pid, rid)
      expect(codes(await readiness(pid))).toEqual([
        'CHANGE_DRAFT_PENDING',
        'CHANGE_UNRESOLVED',
      ])
      expect((await offerPublish(pid, rid, oid)).status).toBe(200)
      expect((await changeDecision(pid, rid, oid)).status).toBe(200)
      expect(codes(await readiness(pid))).toEqual(['CHANGE_NOT_IMPLEMENTED'])
      expect((await close(pid, rid)).status).toBe(409)
      expect(
        (
          await mutate(
            own,
            'post',
            `${projectBase(pid)}/changes/${rid}/implement`,
            {
              expectedRevision: (await changeDetail(pid, rid)).request.revision,
              note: 'Copy implemented.',
            },
          )
        ).status,
      ).toBe(200)
      expect((await readiness(pid)).ready).toBe(true)
      const declined = await change(pid),
        od = await offer(pid, declined)
      expect((await offerPublish(pid, declined, od)).status).toBe(200)
      expect((await changeDecision(pid, declined, od, 'DECLINED')).status).toBe(
        200,
      )
      expect((await readiness(pid)).ready).toBe(true)
      const draft = await offer(pid, declined)
      expect(codes(await readiness(pid))).toEqual([
        'CHANGE_DRAFT_PENDING',
        'CHANGE_UNRESOLVED',
      ])
      expect((await close(pid, declined)).status).toBe(200)
      expect((await readiness(pid)).ready).toBe(true)
      expect((await offerPublish(pid, declined, draft)).status).toBe(409)
      expect((await changeDecision(pid, declined, od, 'DECLINED')).status).toBe(
        409,
      )
    })
    it('reads old unresolved requests beyond list page limits and all checklist rows beyond activity history limits', async () => {
      const { pid } = await ready(),
        unresolved = await change(pid)
      for (let i = 0; i < 21; i++) {
        const rid = await change(pid)
        expect((await close(pid, rid)).status).toBe(200)
      }
      const list = await own.get(`${projectBase(pid)}/changes?page=1`)
      expect(list.body.requests).toHaveLength(20)
      expect(
        list.body.requests.some((r: { id: string }) => r.id === unresolved),
      ).toBe(false)
      expect(codes(await readiness(pid))).toContain('CHANGE_UNRESOLVED')
      expect((await close(pid, unresolved)).status).toBe(200)
      for (let i = 2; i <= 52; i++) await item(pid, i, false)
      const last = await item(pid, 53, true)
      expect(codes(await readiness(pid))).toEqual(['CHECKLIST_INCOMPLETE'])
      const page = await handover(pid)
      expect(page.events).toHaveLength(50)
      expect(page.hasMoreEvents).toBe(true)
      expect((await check(pid, last)).status).toBe(200)
      expect((await readiness(pid)).ready).toBe(true)
    })
    it('keeps private checklist text/actions/snapshots private, checks nested ownership, CSRF, roles and revoked membership', async () => {
      const { pid } = await ready(),
        iid = await item(pid, 2, true, false)
      await dbA.handoverItem.update({
        where: { id: iid },
        data: {
          title: 'OWNER PRIVATE CHECKLIST',
          description: 'PRIVATE INTERNAL TASK',
        },
      })
      let visible = await handover(pid, client)
      expect(JSON.stringify(visible)).not.toContain('PRIVATE')
      expect(
        visible.blockers.find((b) => b.code === 'CHECKLIST_INCOMPLETE')!
          .message,
      ).toBe('An owner-only required checklist item is incomplete.')
      expect((await complete(pid, client)).status).toBe(403)
      expect((await check(pid, iid, true, client)).status).toBe(403)
      expect(
        (
          await mutate(client, 'post', `${projectBase(pid)}/reopen`, {
            expectedRevision: 0,
            reason: 'Pretend owner',
          })
        ).status,
      ).toBe(403)
      expect((await other.get(`${projectBase(pid)}/handover`)).status).toBe(404)
      expect(
        (await other.get(`${projectBase(pid)}/completion-readiness`)).status,
      ).toBe(404)
      expect(
        (await client.get(`${projectBase(pid, orgB)}/handover`)).status,
      ).toBe(404)
      const otherPid = await project()
      expect(
        (
          await mutate(
            own,
            'post',
            `${projectBase(otherPid)}/handover/items/${iid}/check`,
            { completed: true, expectedRevision: 0, reason: 'Wrong project' },
          )
        ).status,
      ).toBe(404)
      expect(
        (
          await own
            .post(`${projectBase(pid)}/complete`)
            .set('Origin', origin)
            .send({ confirm: true, expectedRevision: 0 })
        ).status,
      ).toBe(403)
      await dbA.membership.update({
        where: {
          organizationId_userId: { organizationId: orgA, userId: clientA.id },
        },
        data: { revokedAt: new Date() },
      })
      try {
        expect(
          (await client.get(`${projectBase(pid)}/completion-readiness`)).status,
        ).toBe(404)
        expect((await client.get(`${projectBase(pid)}/handover`)).status).toBe(
          404,
        )
      } finally {
        await dbA.membership.update({
          where: {
            organizationId_userId: { organizationId: orgA, userId: clientA.id },
          },
          data: { revokedAt: null },
        })
      }
      expect((await check(pid, iid)).status).toBe(200)
      expect((await complete(pid)).status).toBe(200)
      visible = await handover(pid, client)
      expect(JSON.stringify(visible)).not.toContain('PRIVATE')
      expect(visible.completions[0]!.snapshot.checklist).toHaveLength(1)
    })
    it('audits checklist edits/unchecks and requires explicit reasons for required-flag changes in all modules', async () => {
      const { pid, iid, did } = await ready(),
        i = (await handover(pid)).items[0]!
      const input = {
        title: i.title,
        description: 'Updated handover task',
        required: false,
        clientVisible: true,
        position: 1,
        expectedRevision: i.revision,
      }
      expect(
        (
          await mutate(
            own,
            'patch',
            `${projectBase(pid)}/handover/items/${iid}`,
            { ...input, reason: '' },
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await mutate(
            own,
            'patch',
            `${projectBase(pid)}/handover/items/${iid}`,
            { ...input, reason: 'Explicitly optional documentation task.' },
          )
        ).status,
      ).toBe(200)
      expect((await handover(pid)).items[0]!.completedAt).toBeNull()
      expect(codes(await readiness(pid))).toEqual(['NO_REQUIRED_CHECKLIST'])
      const d = (await detail(pid, did)).deliverable
      expect(
        (
          await mutate(own, 'patch', `${deliverableBase(pid)}/${did}`, {
            required: false,
            position: 1,
            expectedRevision: d.revision,
          })
        ).status,
      ).toBe(409)
      expect(
        (
          await mutate(own, 'patch', `${deliverableBase(pid)}/${did}`, {
            required: false,
            position: 1,
            expectedRevision: d.revision,
            requiredChangeReason: 'Documented scope exception.',
          })
        ).status,
      ).toBe(200)
      const mid = await milestone(pid, 2, false),
        m = await dbA.milestone.findUniqueOrThrow({ where: { id: mid } }),
        mInput = {
          title: m.title,
          description: m.description,
          dueDate: null,
          required: false,
          position: 2,
          expectedRevision: 0,
        }
      expect(
        (
          await mutate(
            own,
            'patch',
            `${projectBase(pid)}/milestones/${mid}`,
            mInput,
          )
        ).status,
      ).toBe(409)
      expect(
        (
          await mutate(own, 'patch', `${projectBase(pid)}/milestones/${mid}`, {
            ...mInput,
            requiredChangeReason: 'Documented milestone exception.',
          })
        ).status,
      ).toBe(200)
      expect(
        (await handover(pid)).events.filter(
          (e) => e.kind === 'REQUIRED_FLAG_CHANGED',
        ),
      ).toHaveLength(3)
    })
    it('records exactly one completion, immutable snapshot, rejects every completed workflow and supports reasoned new cycles', async () => {
      const { pid, mid, did, vid, iid } = await ready(),
        before = await readiness(pid),
        result = await complete(pid)
      expect(result.status).toBe(200)
      expect((await complete(pid, own, before.project.revision)).body).toEqual(
        result.body,
      )
      let h = await handover(pid, client)
      expect(h.project.status).toBe('COMPLETED')
      expect(h.completions).toHaveLength(1)
      const saved = h.completions[0]!
      expect(saved.snapshot.milestones[0]).toMatchObject({
        id: mid,
        status: 'ACCEPTED',
      })
      expect(saved.snapshot.deliverables[0]).toMatchObject({
        id: did,
        versionId: vid,
        outcome: 'ACCEPTED',
      })
      expect(saved.snapshot.checklist[0]!.completer!.id).toBe(owner.id)
      await expect(
        dbA.projectCompletion.update({
          where: { id: saved.id },
          data: { cycle: 9 },
        }),
      ).rejects.toThrow()
      expect((await reopenMilestone(pid, mid)).status).toBe(409)
      expect((await decision(pid, did, vid)).status).toBe(409)
      expect((await publish(pid, did, vid)).status).toBe(409)
      expect((await withdraw(pid, did, vid)).status).toBe(409)
      expect(
        (
          await mutate(client, 'post', `${projectBase(pid)}/changes`, {
            title: 'New',
            requestedChange: 'New',
            businessContext: 'New',
          })
        ).status,
      ).toBe(409)
      expect((await check(pid, iid, false)).status).toBe(409)
      expect(
        (
          await mutate(own, 'post', `${projectBase(pid)}/handover/items`, {
            title: 'New',
            description: 'New',
            required: true,
            clientVisible: true,
            position: 2,
          })
        ).status,
      ).toBe(409)
      expect((await status(pid, 'CANCEL')).status).toBe(409)
      expect((await status(pid, 'HOLD')).status).toBe(409)
      expect((await reopen(pid, ' ')).status).toBe(400)
      expect((await reopen(pid)).status).toBe(200)
      expect((await readiness(pid)).ready).toBe(true)
      expect((await check(pid, iid, false)).status).toBe(200)
      expect((await complete(pid)).status).toBe(409)
      expect((await check(pid, iid)).status).toBe(200)
      expect((await complete(pid)).status).toBe(200)
      h = await handover(pid)
      expect(h.completions.map((c) => c.cycle)).toEqual([2, 1])
      expect(h.completions[1]).toEqual(saved)
      expect(
        await dbA.handoverEvent.count({
          where: { projectId: pid, kind: 'PROJECT_COMPLETED' },
        }),
      ).toBe(2)
    })
    it('coordinates duplicate completion with independent connections', async () => {
      const { pid } = await ready(),
        expected = (await readiness(pid)).project.revision
      const results = await contend([
        () => complete(pid, own, expected),
        () => complete(pid, ownSecond, expected),
      ])
      expect(results.map((r) => r.status)).toEqual([200, 200])
      expect(results[0]!.body).toEqual(results[1]!.body)
      expect(
        await dbA.projectCompletion.count({ where: { projectId: pid } }),
      ).toBe(1)
      expect(
        await dbA.handoverEvent.count({
          where: { projectId: pid, kind: 'PROJECT_COMPLETED' },
        }),
      ).toBe(1)
    })
    it('coordinates closure versus milestone reopen, deliverable replacement/required change, checklist edit/uncheck, change creation and hold/cancel', async () => {
      for (const action of [
        'milestone',
        'replacement',
        'withdrawal',
        'required',
        'checklist',
        'uncheck',
        'change',
        'hold',
        'cancel',
      ]) {
        const { pid, mid, did, iid } = await ready()
        // Withdrawal cannot invalidate accepted work directly; make a pending replacement, which already blocks readiness.
        let next: string | undefined
        if (action === 'replacement' || action === 'withdrawal')
          next = await revision(pid, did)
        if (action === 'withdrawal')
          expect(
            (await publish(pid, did, next!, 'Pending review')).status,
          ).toBe(200)
        const h = await handover(pid),
          d = (await detail(pid, did)).deliverable,
          i = h.items[0]!,
          expected = h.project.revision
        const body = next
          ? await publishBody(pid, did, next, 'Replacement race')
          : {}
        let mutation: () => Promise<request.Response>
        if (action === 'milestone')
          mutation = () => reopenMilestone(pid, mid, ownSecond)
        else if (action === 'replacement')
          mutation = () =>
            mutate(
              ownSecond,
              'post',
              `${deliverableBase(pid)}/${did}/versions/${next}/publish`,
              body,
            )
        else if (action === 'withdrawal')
          mutation = () =>
            mutate(
              ownSecond,
              'post',
              `${deliverableBase(pid)}/${did}/versions/${next}/withdraw`,
              { expectedRevision: d.revision, reason: 'Withdraw race' },
            )
        else if (action === 'required')
          mutation = () =>
            mutate(ownSecond, 'patch', `${deliverableBase(pid)}/${did}`, {
              required: false,
              position: 1,
              expectedRevision: d.revision,
              requiredChangeReason: 'Required flag race',
            })
        else if (action === 'checklist')
          mutation = () =>
            mutate(
              ownSecond,
              'patch',
              `${projectBase(pid)}/handover/items/${iid}`,
              {
                title: i.title,
                description: 'New task description',
                required: i.required,
                clientVisible: i.clientVisible,
                position: i.position,
                expectedRevision: i.revision,
                reason: 'Edit race',
              },
            )
        else if (action === 'uncheck')
          mutation = () =>
            mutate(
              ownSecond,
              'post',
              `${projectBase(pid)}/handover/items/${iid}/check`,
              {
                completed: false,
                expectedRevision: i.revision,
                reason: 'Uncheck race',
              },
            )
        else if (action === 'change')
          mutation = () =>
            mutate(second, 'post', `${projectBase(pid)}/changes`, {
              title: 'Race request',
              requestedChange: 'New scope',
              businessContext: 'New need',
            })
        else
          mutation = () =>
            mutate(ownSecond, 'post', `${projectBase(pid)}/status`, {
              action: action.toUpperCase(),
              reason: 'Status race',
              expectedRevision: expected,
            })
        const results = await contend([
          () => complete(pid, own, expected),
          mutation,
        ])
        if (action === 'withdrawal') {
          expect(results.map((r) => r.status)).toEqual([409, 200])
          continue
        }
        expect(results.map((r) => r.status).sort()).toEqual(
          action === 'change' && results[0]!.status !== 200
            ? [201, 409]
            : [200, 409],
        )
        const saved = await handover(pid)
        if (results[0]!.status === 200) {
          expect(saved.project.status).toBe('COMPLETED')
          expect(saved.completions).toHaveLength(1)
        } else {
          expect(saved.project.status).not.toBe('COMPLETED')
          expect(saved.completions).toHaveLength(0)
          expect(saved.ready).toBe(false)
        }
      }
    })
    it('rejects stale advisory readiness after new offers and preserves all history on event failure', async () => {
      const { pid } = await ready(),
        before = await handover(pid),
        rid = await change(pid),
        oid = await offer(pid, rid)
      expect((await complete(pid, own, before.project.revision)).status).toBe(
        409,
      )
      expect((await offerPublish(pid, rid, oid)).status).toBe(200)
      expect((await close(pid, rid)).status).toBe(200)
      const readyBefore = await handover(pid),
        name = `qa_handover_${tag.replaceAll('-', '')}`
      await dbA.$executeRawUnsafe(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.project_id='${pid}'::uuid AND NEW.kind::text IN ('PROJECT_COMPLETED','PROJECT_REOPENED') THEN RAISE EXCEPTION 'Injected handover activity failure'; END IF; RETURN NEW; END $$`,
      )
      await dbA.$executeRawUnsafe(
        `CREATE TRIGGER ${name} BEFORE INSERT ON handover_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      )
      try {
        expect((await complete(pid)).status).toBe(500)
        expect(await handover(pid)).toEqual(readyBefore)
        expect(
          await dbA.projectCompletion.count({ where: { projectId: pid } }),
        ).toBe(0)
      } finally {
        await dbA.$executeRawUnsafe(`DROP TRIGGER ${name} ON handover_events`)
      }
      expect((await complete(pid)).status).toBe(200)
      const closed = await handover(pid)
      await dbA.$executeRawUnsafe(
        `CREATE TRIGGER ${name} BEFORE INSERT ON handover_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      )
      try {
        expect((await reopen(pid)).status).toBe(500)
        expect(await handover(pid)).toEqual(closed)
      } finally {
        await dbA.$executeRawUnsafe(`DROP TRIGGER ${name} ON handover_events`)
        await dbA.$executeRawUnsafe(`DROP FUNCTION ${name}()`)
      }
    })
    it('blocks approval-frozen drafts until explicit abandonment and coordinates completion versus a new draft on a declined request', async () => {
      const { pid } = await ready(),
        rid = await change(pid),
        oid = await offer(pid, rid)
      expect((await offerPublish(pid, rid, oid)).status).toBe(200)
      const frozen = await offer(pid, rid)
      expect((await changeDecision(pid, rid, oid)).status).toBe(200)
      expect(
        (
          await mutate(
            own,
            'post',
            `${projectBase(pid)}/changes/${rid}/implement`,
            {
              expectedRevision: (await changeDetail(pid, rid)).request.revision,
              note: 'Recorded implementation.',
            },
          )
        ).status,
      ).toBe(200)
      expect(codes(await readiness(pid))).toEqual(['CHANGE_DRAFT_PENDING'])
      expect(
        (
          await mutate(
            own,
            'post',
            `${projectBase(pid)}/changes/${rid}/offers/${frozen}/abandon`,
            {
              expectedRevision: 0,
              reason: 'Draft obsolete after earlier approval.',
            },
          )
        ).status,
      ).toBe(200)
      expect((await readiness(pid)).ready).toBe(true)
      expect(
        (await changeDetail(pid, rid)).request.offers.find(
          (o: { id: string }) => o.id === frozen,
        ).state,
      ).toBe('ABANDONED')
      const publicView = await client.get(`${projectBase(pid)}/changes/${rid}`)
      expect(publicView.body.request.offers).toHaveLength(1)
      const declined = await change(pid),
        offered = await offer(pid, declined)
      expect((await offerPublish(pid, declined, offered)).status).toBe(200)
      expect(
        (await changeDecision(pid, declined, offered, 'DECLINED')).status,
      ).toBe(200)
      const expected = (await handover(pid)).project.revision,
        requestRevision = (await changeDetail(pid, declined)).request.revision
      const results = await contend([
        () => complete(pid, own, expected),
        () =>
          mutate(
            ownSecond,
            'post',
            `${projectBase(pid)}/changes/${declined}/offers`,
            { expectedRevision: requestRevision },
          ),
      ])
      expect(results.map((r) => r.status).sort()).toEqual(
        results[0]!.status === 200 ? [200, 409] : [201, 409],
      )
      if (results[0]!.status !== 200)
        expect(codes(await readiness(pid))).toContain('CHANGE_DRAFT_PENDING')
    })
  },
)
