import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { once } from 'node:events'
import { randomUUID, createHmac } from 'node:crypto'
import { Pool } from 'pg'
import type { Server } from 'node:http'
import type {
  Identity,
  ProposalDraft,
  WorkflowDto,
  MilestoneInput,
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
  value.searchParams.set('application_name', `jcb-workflow-${side}-${tag}`)
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
        [[`jcb-workflow-a-${tag}`, `jcb-workflow-b-${tag}`]],
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
      name: 'Workflow owner',
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
const projectBase = (id: string, org = orgA) =>
  `/api/organizations/${org}/projects/${id}`
const milestoneInput = (position = 1): MilestoneInput => ({
  title: 'Website preview',
  description: 'Text-only preview of the approved website scope.',
  dueDate: '2026-01-01',
  required: true,
  position,
})
async function project() {
  const proposal = await create()
  expect((await send(proposal)).status).toBe(200)
  const result = await decide(client, proposal)
  expect(result.status).toBe(200)
  return result.body.projectId as string
}
async function workflow(id: string, agent = own) {
  const response = await agent.get(`${projectBase(id)}/workflow`)
  expect(response.status).toBe(200)
  return response.body as WorkflowDto
}
async function add(id: string, position = 1) {
  const response = await mutate(
    own,
    'post',
    `${projectBase(id)}/milestones`,
    milestoneInput(position),
  )
  expect(response.status).toBe(201)
  return response.body.milestoneId as string
}
async function act(
  id: string,
  mid: string,
  action: string,
  reason = '',
  agent = own,
  expected?: number,
) {
  const m = (await workflow(id)).milestones.find((m) => m.id === mid)!
  return mutate(agent, 'post', `${projectBase(id)}/milestones/${mid}/actions`, {
    action,
    reason,
    expectedRevision: expected ?? m.revision,
  })
}
async function status(id: string, action: string, reason = '', agent = own) {
  const p = (await workflow(id)).project
  return mutate(agent, 'post', `${projectBase(id)}/status`, {
    action,
    reason,
    expectedRevision: p.revision,
  })
}
async function pendingReview(id: string) {
  const mid = await add(id)
  expect((await act(id, mid, 'START')).status).toBe(200)
  const response = await act(id, mid, 'SUBMIT')
  expect(response.status).toBe(200)
  return { mid, rid: response.body.reviewId as string }
}
async function review(
  id: string,
  mid: string,
  rid: string,
  outcome = 'ACCEPTED',
  feedback = '',
  agent = client,
) {
  return mutate(
    agent,
    'post',
    `${projectBase(id)}/milestones/${mid}/reviews/${rid}/decision`,
    { outcome, feedback },
  )
}
describe('project lifecycle and immutable milestone reviews', () => {
  it('rechecks a revocation committed while an review waits for its organization lock', async () => {
    const id = await project(),
      { mid, rid } = await pendingReview(id)
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
      pending = review(id, mid, rid, 'ACCEPTED', '', second)
      let blocked = false
      for (let i = 0; i < 200; i++) {
        const rows = await poolB.query<{ count: string }>(
          "SELECT count(*) FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
          [`jcb-workflow-b-${tag}`],
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
        (await dbA.milestoneReview.findUniqueOrThrow({ where: { id: rid } }))
          .status,
      ).toBe('PENDING')
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

  it('validates project transitions, hold reasons/resume state and irreversible cancellation', async () => {
    const id = await project()
    expect((await status(id, 'REVIEW')).status).toBe(409)
    expect((await status(id, 'HOLD')).status).toBe(400)
    expect((await status(id, 'CANCEL')).status).toBe(400)
    expect((await status(id, 'COMPLETE')).status).toBe(400)
    expect((await status(id, 'HOLD', 'Waiting for client copy')).status).toBe(
      200,
    )
    expect((await workflow(id)).project.resumeStatus).toBe('PLANNED')
    expect(
      (
        await mutate(
          own,
          'post',
          `${projectBase(id)}/milestones`,
          milestoneInput(),
        )
      ).status,
    ).toBe(409)
    expect((await status(id, 'RESUME')).status).toBe(200)
    expect((await workflow(id)).project.status).toBe('PLANNED')
    expect((await status(id, 'ACTIVATE')).status).toBe(200)
    expect((await status(id, 'ACTIVATE')).status).toBe(409)
    expect((await status(id, 'HOLD', 'Awaiting review materials')).status).toBe(
      200,
    )
    expect((await status(id, 'RESUME')).status).toBe(200)
    expect((await workflow(id)).project.status).toBe('ACTIVE')
    expect((await status(id, 'REVIEW')).status).toBe(200)
    expect((await status(id, 'HOLD', 'Client away')).status).toBe(200)
    expect((await status(id, 'RESUME')).status).toBe(200)
    expect((await workflow(id)).project.status).toBe('IN_REVIEW')
    expect((await status(id, 'CANCEL', 'Engagement discontinued')).status).toBe(
      200,
    )
    expect((await status(id, 'RESUME')).status).toBe(409)
    const data = await workflow(id, client)
    expect(data.project.status).toBe('CANCELLED')
    expect(data.project.resumeStatus).toBeNull()
    expect(data.events[0]!.reason).toBe('Engagement discontinued')
  })
  it('edits bounded date-only metadata with stable unique order and optimistic revisions', async () => {
    const id = await project(),
      mid = await add(id, 7)
    await add(id, 2)
    expect((await workflow(id)).milestones.map((m) => m.position)).toEqual([
      2, 7,
    ])
    const path = `${projectBase(id)}/milestones/${mid}`
    expect(
      (
        await mutate(own, 'patch', path, {
          ...milestoneInput(7),
          dueDate: '2026-02-30',
          expectedRevision: 0,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await mutate(own, 'patch', path, {
          ...milestoneInput(2),
          expectedRevision: 0,
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await mutate(own, 'patch', path, {
          ...milestoneInput(7),
          required: false,
          expectedRevision: 0,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await mutate(own, 'patch', path, {
          ...milestoneInput(7),
          expectedRevision: 0,
        })
      ).status,
    ).toBe(409)
    expect((await workflow(id)).milestones[1]!.dueDate).toBe('2026-01-01')
    expect((await workflow(id)).progress).toEqual({ accepted: 0, total: 1 })
  })
  it('requests changes, preserves snapshots, resubmits numbered rounds and accepts', async () => {
    const id = await project(),
      { mid, rid } = await pendingReview(id)
    expect((await act(id, mid, 'SUBMIT')).status).toBe(409)
    expect(
      (
        await mutate(own, 'patch', `${projectBase(id)}/milestones/${mid}`, {
          ...milestoneInput(),
          title: 'tampered',
          expectedRevision: 2,
        })
      ).status,
    ).toBe(409)
    await expect(
      dbA.milestoneReview.update({
        where: { id: rid },
        data: { description: 'tampered snapshot' },
      }),
    ).rejects.toThrow()
    expect((await review(id, mid, rid, 'CHANGES_REQUESTED')).status).toBe(400)
    const changes = await review(
      id,
      mid,
      rid,
      'CHANGES_REQUESTED',
      'Please simplify the navigation.',
    )
    expect(changes.status).toBe(200)
    expect(
      (
        await review(
          id,
          mid,
          rid,
          'CHANGES_REQUESTED',
          'Please simplify the navigation.',
        )
      ).body,
    ).toEqual(changes.body)
    expect((await review(id, mid, rid)).status).toBe(409)
    const m = (await workflow(id)).milestones[0]!
    expect(m.status).toBe('IN_PROGRESS')
    expect(
      (
        await mutate(own, 'patch', `${projectBase(id)}/milestones/${mid}`, {
          ...milestoneInput(),
          title: 'Revised preview',
          description: 'Simplified navigation text.',
          expectedRevision: m.revision,
        })
      ).status,
    ).toBe(200)
    const submitted = await act(id, mid, 'SUBMIT'),
      secondRound = submitted.body.reviewId as string
    expect(
      (
        await review(
          id,
          mid,
          rid,
          'CHANGES_REQUESTED',
          'Please simplify the navigation.',
        )
      ).status,
    ).toBe(409)
    expect((await review(id, mid, secondRound)).status).toBe(200)
    const data = await workflow(id, client)
    expect(data.progress).toEqual({ accepted: 1, total: 1 })
    expect(data.milestones[0]!.overdue).toBe(false)
    expect(data.milestones[0]!.reviews.map((r) => r.number)).toEqual([2, 1])
    expect(data.milestones[0]!.reviews[1]!.description).toBe(
      milestoneInput().description,
    )
    expect(data.milestones[0]!.reviews[1]!.feedback).toBe(
      'Please simplify the navigation.',
    )
    expect(JSON.stringify(data)).not.toContain('OWNER PRIVATE')
    await expect(
      dbA.milestoneReview.update({
        where: { id: secondRound },
        data: { feedback: 'rewritten receipt' },
      }),
    ).rejects.toThrow()
  })
  it('withdraws with a reason, rejects stale/withdrawn reviews and preserves history on reopening', async () => {
    const id = await project(),
      { mid, rid } = await pendingReview(id)
    expect((await act(id, mid, 'WITHDRAW')).status).toBe(400)
    expect(
      (await act(id, mid, 'WITHDRAW', 'Correcting review text')).status,
    ).toBe(200)
    expect((await review(id, mid, rid)).status).toBe(409)
    const next = (await act(id, mid, 'SUBMIT')).body.reviewId as string
    expect((await review(id, mid, next)).status).toBe(200)
    expect((await act(id, mid, 'REOPEN')).status).toBe(400)
    expect(
      (await act(id, mid, 'REOPEN', 'Client requested another review')).status,
    ).toBe(200)
    expect((await review(id, mid, next)).status).toBe(409)
    let data = await workflow(id)
    expect(data.progress).toEqual({ accepted: 0, total: 1 })
    expect(data.milestones[0]!.reviews[0]!.status).toBe('ACCEPTED')
    expect(data.milestones[0]!.reviews[1]!.withdrawalReason).toBe(
      'Correcting review text',
    )
    expect(
      data.events.some(
        (e) =>
          e.kind === 'MILESTONE_REOPENED' &&
          e.reason === 'Client requested another review',
      ),
    ).toBe(true)
    const third = (await act(id, mid, 'SUBMIT')).body.reviewId as string
    expect((await review(id, mid, third)).status).toBe(200)
    data = await workflow(id)
    expect(data.milestones[0]!.reviews.map((r) => r.number)).toEqual([3, 2, 1])
    expect(data.progress).toEqual({ accepted: 1, total: 1 })
  })
  it('enforces owner/client roles, CSRF/Origin, nested relations and two-organization isolation', async () => {
    const id = await project(),
      { mid, rid } = await pendingReview(id),
      another = await project()
    expect((await review(id, mid, rid, 'ACCEPTED', '', own)).status).toBe(403)
    expect(
      (
        await mutate(
          client,
          'post',
          `${projectBase(id)}/milestones`,
          milestoneInput(2),
        )
      ).status,
    ).toBe(403)
    expect((await status(id, 'ACTIVATE', '', client)).status).toBe(403)
    expect(
      (await act(id, mid, 'WITHDRAW', 'Client trying owner action', client))
        .status,
    ).toBe(403)
    expect((await other.get(`${projectBase(id)}/workflow`)).status).toBe(404)
    expect((await client.get(`${projectBase(id, orgB)}/workflow`)).status).toBe(
      404,
    )
    expect((await review(id, mid, rid, 'ACCEPTED', '', other)).status).toBe(404)
    expect((await review(another, mid, rid)).status).toBe(404)
    const anotherRound = await pendingReview(another)
    expect((await review(id, mid, anotherRound.rid)).status).toBe(404)
    expect(
      (
        await own
          .post(`${projectBase(id)}/status`)
          .set('Origin', origin)
          .send({ action: 'ACTIVATE', expectedRevision: 0 })
      ).status,
    ).toBe(403)
    expect(
      (
        await own
          .post(`${projectBase(id)}/status`)
          .set('Origin', 'https://untrusted.test')
          .set('X-CSRF-Token', await csrf(own))
          .send({ action: 'ACTIVATE', expectedRevision: 0 })
      ).status,
    ).toBe(403)
    await dbA.membership.update({
      where: {
        organizationId_userId: { organizationId: orgA, userId: clientA.id },
      },
      data: { revokedAt: new Date() },
    })
    try {
      expect((await client.get(`${projectBase(id)}/workflow`)).status).toBe(404)
      expect((await review(id, mid, rid)).status).toBe(404)
    } finally {
      await dbA.membership.update({
        where: {
          organizationId_userId: { organizationId: orgA, userId: clientA.id },
        },
        data: { revokedAt: null },
      })
    }
  })
  it('blocks every workflow mutation during hold/cancellation while preserving reads and overdue rules', async () => {
    const id = await project(),
      { mid, rid } = await pendingReview(id)
    expect((await workflow(id)).milestones[0]!.overdue).toBe(true)
    expect((await status(id, 'HOLD', 'Waiting for materials')).status).toBe(200)
    for (const state of ['ON_HOLD', 'CANCELLED']) {
      expect((await workflow(id, client)).project.status).toBe(state)
      expect((await review(id, mid, rid)).status).toBe(409)
      expect((await act(id, mid, 'WITHDRAW', 'Try withdrawal')).status).toBe(
        409,
      )
      expect(
        (
          await mutate(own, 'patch', `${projectBase(id)}/milestones/${mid}`, {
            ...milestoneInput(),
            expectedRevision: 2,
          })
        ).status,
      ).toBe(409)
      expect(
        (
          await mutate(
            own,
            'post',
            `${projectBase(id)}/milestones`,
            milestoneInput(2),
          )
        ).status,
      ).toBe(409)
      if (state === 'ON_HOLD')
        expect(
          (await status(id, 'CANCEL', 'Engagement cancelled')).status,
        ).toBe(200)
    }
    expect((await workflow(id)).milestones[0]!.overdue).toBe(false)
    expect(
      (await dbA.milestoneReview.findUniqueOrThrow({ where: { id: rid } }))
        .status,
    ).toBe('PENDING')
  })
  it('returns the original result for overlapping identical decisions with one history entry', async () => {
    const id = await project(),
      { mid, rid } = await pendingReview(id)
    const results = await contend([
      () => review(id, mid, rid),
      () => review(id, mid, rid, 'ACCEPTED', '', second),
    ])
    expect(results.map((r) => r.status)).toEqual([200, 200])
    expect(results[0]!.body).toEqual(results[1]!.body)
    expect(
      await dbA.workflowEvent.count({
        where: { milestoneId: mid, kind: 'MILESTONE_DECIDED' },
      }),
    ).toBe(1)
    expect((await workflow(id)).progress).toEqual({ accepted: 1, total: 1 })
  })
  it('resolves conflicting concurrent client decisions to one consistent outcome', async () => {
    const id = await project(),
      { mid, rid } = await pendingReview(id)
    const results = await contend([
      () => review(id, mid, rid),
      () =>
        review(id, mid, rid, 'CHANGES_REQUESTED', 'Revise the text', second),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const data = await workflow(id),
      round = data.milestones[0]!.reviews[0]!
    expect(data.milestones[0]!.status).toBe(
      round.status === 'ACCEPTED' ? 'ACCEPTED' : 'IN_PROGRESS',
    )
    expect(data.progress.accepted).toBe(round.status === 'ACCEPTED' ? 1 : 0)
    expect(
      data.events.filter((e) => e.kind === 'MILESTONE_DECIDED'),
    ).toHaveLength(1)
  })
  it('coordinates review versus withdrawal, cancellation and hold on separate connections', async () => {
    for (const op of ['WITHDRAW', 'CANCEL', 'HOLD']) {
      const id = await project(),
        { mid, rid } = await pendingReview(id)
      const snapshot = await workflow(id),
        m = snapshot.milestones[0]!
      const ownerOp = () =>
        op === 'WITHDRAW'
          ? mutate(
              ownSecond,
              'post',
              `${projectBase(id)}/milestones/${mid}/actions`,
              {
                action: op,
                expectedRevision: m.revision,
                reason: 'Workflow race test',
              },
            )
          : mutate(ownSecond, 'post', `${projectBase(id)}/status`, {
              action: op,
              expectedRevision: snapshot.project.revision,
              reason: 'Workflow race test',
            })
      const results = await contend([() => review(id, mid, rid), ownerOp])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409])
      const data = await workflow(id),
        round = data.milestones[0]!.reviews[0]!
      if (results[0]!.status === 200) {
        expect(round.status).toBe('ACCEPTED')
        expect(data.project.status).toBe('PLANNED')
      } else if (op === 'WITHDRAW') {
        expect(round.status).toBe('WITHDRAWN')
        expect(data.milestones[0]!.status).toBe('IN_PROGRESS')
      } else {
        expect(round.status).toBe('PENDING')
        expect(data.project.status).toBe(
          op === 'HOLD' ? 'ON_HOLD' : 'CANCELLED',
        )
      }
    }
  })
  it('coordinates a retried acceptance versus reopening without losing the earlier receipt', async () => {
    const id = await project(),
      { mid, rid } = await pendingReview(id)
    expect((await review(id, mid, rid)).status).toBe(200)
    const m = (await workflow(id)).milestones[0]!
    const results = await contend([
      () => review(id, mid, rid),
      () =>
        mutate(
          ownSecond,
          'post',
          `${projectBase(id)}/milestones/${mid}/actions`,
          {
            action: 'REOPEN',
            expectedRevision: m.revision,
            reason: 'Another review needed',
          },
        ),
    ])
    expect(results[1]!.status).toBe(200)
    expect([200, 409]).toContain(results[0]!.status)
    const data = await workflow(id)
    expect(data.progress).toEqual({ accepted: 0, total: 1 })
    expect(data.milestones[0]!.status).toBe('IN_PROGRESS')
    expect(data.milestones[0]!.reviews[0]!.status).toBe('ACCEPTED')
    expect(
      data.events.filter((e) => e.kind === 'MILESTONE_DECIDED'),
    ).toHaveLength(1)
    expect(
      data.events.filter((e) => e.kind === 'MILESTONE_REOPENED'),
    ).toHaveLength(1)
  })
  it('rolls back state, receipt, workflow history and activity if event insertion fails', async () => {
    const id = await project(),
      { mid, rid } = await pendingReview(id)
    const before = await workflow(id),
      name = `qa_workflow_${tag.replaceAll('-', '')}`
    // Generated UUID interpolations only, trigger restricted to this run's project.
    await dbA.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id = '${orgA}'::uuid AND NEW.kind::text = 'MILESTONE_DECIDED' THEN RAISE EXCEPTION 'Injected workflow failure'; END IF; RETURN NEW; END $$`,
    )
    await dbA.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    )
    try {
      expect((await review(id, mid, rid)).status).toBe(500)
      const after = await workflow(id)
      expect(after).toEqual(before)
      expect(
        (await dbA.milestoneReview.findUniqueOrThrow({ where: { id: rid } }))
          .status,
      ).toBe('PENDING')
    } finally {
      await dbA.$executeRawUnsafe(`DROP TRIGGER ${name} ON activity_events`)
      await dbA.$executeRawUnsafe(`DROP FUNCTION ${name}()`)
    }
    expect((await review(id, mid, rid)).status).toBe(200)
  })
})
