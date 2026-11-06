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
  value.searchParams.set('application_name', `jcb-deliverable-${side}-${tag}`)
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
        [[`jcb-deliverable-a-${tag}`, `jcb-deliverable-b-${tag}`]],
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
describe('versioned deliverables', () => {
  it('hides drafts, checks every nested relation and rejects client authoring, owner decisions, CSRF and unsafe URLs', async () => {
    const pid = await project(),
      { did, vid } = await deliverable(pid)
    expect((await client.get(deliverableBase(pid))).body.deliverables).toEqual(
      [],
    )
    expect((await client.get(`${deliverableBase(pid)}/${did}`)).status).toBe(
      404,
    )
    expect((await decision(pid, did, vid)).status).toBe(404)
    expect(
      (
        await mutate(client, 'post', deliverableBase(pid), {
          ...content(),
          required: true,
          position: 2,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await mutate(
          own,
          'patch',
          `${deliverableBase(pid)}/${did}/versions/${vid}`,
          {
            ...content(),
            links: [{ label: 'bad', url: 'https://127.0.0.1/x' }],
            expectedRevision: 0,
          },
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await own
          .post(`${deliverableBase(pid)}/${did}/versions/${vid}/publish`)
          .set('Origin', origin)
          .send(await publishBody(pid, did, vid))
      ).status,
    ).toBe(403)
    expect((await publish(pid, did, vid)).status).toBe(200)
    expect((await decision(pid, did, vid, 'ACCEPTED', own)).status).toBe(403)
    expect((await other.get(deliverableBase(pid))).status).toBe(404)
    expect((await other.get(`${deliverableBase(pid)}/${did}`)).status).toBe(404)
    expect((await decision(pid, did, vid, 'ACCEPTED', other)).status).toBe(404)
    expect(
      (await client.get(`${deliverableBase(pid, orgB)}/${did}`)).status,
    ).toBe(404)
    const p2 = await project(),
      d2 = await deliverable(p2)
    expect((await own.get(`${deliverableBase(p2)}/${did}`)).status).toBe(404)
    expect(
      (
        await mutate(
          own,
          'patch',
          `${deliverableBase(p2)}/${d2.did}/versions/${vid}`,
          { ...content(), expectedRevision: 0 },
        )
      ).status,
    ).toBe(404)
  })
  it('preserves immutable numbered snapshots and feedback through changes, resubmission, acceptance and reasoned replacement', async () => {
    const pid = await project(),
      { did, vid } = await published(pid)
    expect(
      (await decision(pid, did, vid, 'CHANGES_REQUESTED', client, ' ')).status,
    ).toBe(400)
    expect(
      (
        await decision(
          pid,
          did,
          vid,
          'CHANGES_REQUESTED',
          client,
          'Clarify the heading.',
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await mutate(
          own,
          'patch',
          `${deliverableBase(pid)}/${did}/versions/${vid}`,
          { ...content('rewrite'), expectedRevision: 0 },
        )
      ).status,
    ).toBe(409)
    await expect(
      dbA.deliverableVersion.update({
        where: { id: vid },
        data: { description: 'rewrite' },
      }),
    ).rejects.toThrow()
    const next = await revision(pid, did)
    expect((await detail(pid, did, client)).deliverable.versions).toHaveLength(
      1,
    )
    expect((await detail(pid, did, client)).deliverable.currentVersionId).toBe(
      vid,
    )
    expect(
      (
        await mutate(
          own,
          'patch',
          `${deliverableBase(pid)}/${did}/versions/${next}`,
          { ...content('Revised preview'), expectedRevision: 0 },
        )
      ).status,
    ).toBe(200)
    expect((await publish(pid, did, next)).status).toBe(200)
    expect(
      (
        await decision(
          pid,
          did,
          vid,
          'CHANGES_REQUESTED',
          client,
          'Clarify the heading.',
        )
      ).status,
    ).toBe(409)
    const accepted = await decision(pid, did, next)
    expect(accepted.status).toBe(200)
    expect((await decision(pid, did, next)).body).toEqual(accepted.body)
    expect(
      (await decision(pid, did, next, 'CHANGES_REQUESTED', client, 'different'))
        .status,
    ).toBe(409)
    const third = await revision(pid, did)
    expect((await detail(pid, did, client)).deliverable.acceptance).toBe(
      'ACCEPTED',
    )
    expect((await publish(pid, did, third)).status).toBe(409)
    expect(
      (await publish(pid, did, third, 'Updated deliverable copy')).status,
    ).toBe(200)
    const d = (await detail(pid, did, client)).deliverable
    expect(d.acceptance).toBe('PENDING_REVIEW')
    expect(d.versions.map((v) => v.number)).toEqual([3, 2, 1])
    expect(d.versions[1]!.decision).toEqual(accepted.body.decision)
    expect(d.versions[2]!.decision!.feedback).toBe('Clarify the heading.')
    expect(d.versions[0]!.decision).toBeNull()
    expect(d.versions[0]!.publicationReason).toBe('Updated deliverable copy')
    expect((await decision(pid, did, third)).status).toBe(200)
  })
  it('withdraws only pending versions with reasons and audits required-flag changes without deleting history', async () => {
    const pid = await project(),
      { did, vid } = await published(pid)
    expect((await withdraw(pid, did, vid, ' ')).status).toBe(400)
    expect((await withdraw(pid, did, vid)).status).toBe(200)
    expect((await decision(pid, did, vid)).status).toBe(409)
    expect((await detail(pid, did, client)).deliverable.acceptance).toBe(
      'WITHDRAWN',
    )
    const next = await revision(pid, did)
    expect((await publish(pid, did, next)).status).toBe(200)
    const d = (await detail(pid, did)).deliverable
    expect(
      (
        await mutate(own, 'patch', `${deliverableBase(pid)}/${did}`, {
          required: false,
          position: 3,
          expectedRevision: d.revision,
        })
      ).status,
    ).toBe(200)
    const after = (await detail(pid, did, client)).deliverable
    expect(after).toMatchObject({ required: false, position: 3 })
    expect(
      after.events.find((e) => e.kind === 'DELIVERABLE_METADATA_CHANGED'),
    ).toMatchObject({ requiredBefore: true, requiredAfter: false })
    expect(after.versions[1]!.state).toBe('WITHDRAWN')
    expect((await decision(pid, did, next)).status).toBe(200)
    expect((await withdraw(pid, did, next)).status).toBe(409)
  })
  it('returns the same receipt for overlapping identical decisions and one winner for conflicting decisions', async () => {
    const pid = await project(),
      { did, vid } = await published(pid)
    const r = await contend([
      () => decision(pid, did, vid),
      () => decision(pid, did, vid, 'ACCEPTED', second),
    ])
    expect(r.map((x) => x.status)).toEqual([200, 200])
    expect(r[0]!.body).toEqual(r[1]!.body)
    expect(
      await dbA.deliverableDecision.count({ where: { versionId: vid } }),
    ).toBe(1)
    expect(
      await dbA.deliverableEvent.count({
        where: { deliverableId: did, kind: 'DELIVERABLE_DECIDED' },
      }),
    ).toBe(1)
    const next = await revision(pid, did)
    expect((await publish(pid, did, next, 'New preview')).status).toBe(200)
    const conflict = await contend([
      () => decision(pid, did, next),
      () =>
        decision(pid, did, next, 'CHANGES_REQUESTED', second, 'Please revise'),
    ])
    expect(conflict.map((x) => x.status).sort()).toEqual([200, 409])
  })
  it('coordinates review versus replacement and withdrawal with separate connections', async () => {
    for (const action of ['publish', 'withdraw']) {
      const pid = await project(),
        { did, vid } = await published(pid)
      const next = action === 'publish' ? await revision(pid, did) : vid
      const d = (await detail(pid, did)).deliverable
      const body =
        action === 'publish'
          ? await publishBody(pid, did, next, 'Replaced preview')
          : { expectedRevision: d.revision, reason: 'Wrong preview' }
      const r = await contend([
        () => decision(pid, did, vid),
        () =>
          mutate(
            ownSecond,
            'post',
            `${deliverableBase(pid)}/${did}/versions/${next}/${action}`,
            body,
          ),
      ])
      expect(r.map((x) => x.status).sort()).toEqual([200, 409])
      const saved = (await detail(pid, did)).deliverable
      if (r[0]!.status === 200) {
        expect(saved.acceptance).toBe('ACCEPTED')
        expect(saved.currentVersionId).toBe(vid)
      } else {
        expect(saved.acceptance).toBe(
          action === 'publish' ? 'PENDING_REVIEW' : 'WITHDRAWN',
        )
        expect(saved.versions.find((v) => v.id === vid)!.decision).toBeNull()
      }
    }
  })
  it('retains read access on hold/cancel, rejects mutations and coordinates status races', async () => {
    const pid = await project(),
      { did, vid } = await published(pid)
    expect((await status(pid, 'HOLD')).status).toBe(200)
    expect((await decision(pid, did, vid)).status).toBe(409)
    expect((await withdraw(pid, did, vid)).status).toBe(409)
    expect((await detail(pid, did, client)).project.status).toBe('ON_HOLD')
    expect((await status(pid, 'RESUME')).status).toBe(200)
    for (const action of ['HOLD', 'CANCEL']) {
      const p = await project(),
        d = await published(p),
        projectState = (await detail(p, d.did)).project
      const r = await contend([
        () => decision(p, d.did, d.vid),
        () =>
          mutate(
            ownSecond,
            'post',
            `/api/organizations/${orgA}/projects/${p}/status`,
            { action, reason: 'Race', expectedRevision: projectState.revision },
          ),
      ])
      expect(r.map((x) => x.status).sort()).toEqual([200, 409])
      const saved = await detail(p, d.did, client)
      expect(saved.deliverable.acceptance).toBe(
        r[0]!.status === 200 ? 'ACCEPTED' : 'PENDING_REVIEW',
      )
    }
    expect((await status(pid, 'CANCEL')).status).toBe(200)
    expect((await publish(pid, did, vid)).status).toBe(409)
    expect((await decision(pid, did, vid)).status).toBe(409)
    expect((await detail(pid, did, client)).project.status).toBe('CANCELLED')
  })
  it('rechecks revoked membership while a decision waits at the organization lock', async () => {
    const pid = await project(),
      { did, vid } = await published(pid),
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
      pending = decision(pid, did, vid, 'ACCEPTED', second)
      let blocked = false
      for (let i = 0; i < 200; i++) {
        const count = await poolB.query<{ count: string }>(
          "SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
          [`jcb-deliverable-b-${tag}`],
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
      expect((await client.get(deliverableBase(pid))).status).toBe(404)
      expect((await client.get(`${deliverableBase(pid)}/${did}`)).status).toBe(
        404,
      )
      expect(
        await dbA.deliverableDecision.count({ where: { versionId: vid } }),
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
  it('rolls back receipt, version, pointer and activity when event insertion fails', async () => {
    const pid = await project(),
      { did, vid } = await published(pid),
      before = await detail(pid, did),
      name = `qa_delivery_${tag.replaceAll('-', '')}`
    await dbA.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.deliverable_id='${did}'::uuid THEN RAISE EXCEPTION 'Injected deliverable event failure'; END IF; RETURN NEW; END $$`,
    )
    await dbA.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON deliverable_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    )
    try {
      expect((await decision(pid, did, vid)).status).toBe(500)
      expect(await detail(pid, did)).toEqual(before)
      expect(
        await dbA.deliverableDecision.count({ where: { versionId: vid } }),
      ).toBe(0)
    } finally {
      await dbA.$executeRawUnsafe(`DROP TRIGGER ${name} ON deliverable_events`)
    }
    const next = await revision(pid, did),
      beforePublish = await detail(pid, did)
    await dbA.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON deliverable_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    )
    try {
      expect((await publish(pid, did, next)).status).toBe(500)
      expect(await detail(pid, did)).toEqual(beforePublish)
    } finally {
      await dbA.$executeRawUnsafe(`DROP TRIGGER ${name} ON deliverable_events`)
      await dbA.$executeRawUnsafe(`DROP FUNCTION ${name}()`)
    }
    expect((await publish(pid, did, next)).status).toBe(200)
  })
})
