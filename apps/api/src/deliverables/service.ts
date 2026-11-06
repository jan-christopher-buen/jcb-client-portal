import { z } from 'zod'
import {
  deliverableCreateSchema,
  deliverableContentSchema,
  deliverableMetadataSchema,
  deliverableDecisionSchema,
  deliverablePublishSchema,
  type DeliverableContent,
  type DeliverableDto,
} from '@jcb/contracts'
import type {
  PrismaClient,
  Prisma,
  Project,
  Deliverable,
} from '../generated/prisma/client.js'
import { lockedProject, assertProjectWritable } from '../projects/service.js'
import { scopedOrganization } from '../proposals/service.js'
import { HttpError, notFound } from '../errors.js'
type Db = Prisma.TransactionClient
type Actor = Express.User
const conflict = (code: string, message: string) =>
  new HttpError(409, code, message)
function role(actor: Actor, required: 'OWNER' | 'CLIENT') {
  if (actor.role !== required)
    throw new HttpError(
      403,
      'FORBIDDEN',
      `${required === 'OWNER' ? 'Owner' : 'Active client'} access required.`,
    )
}
function revision(row: { revision: number }, expected: number) {
  if (row.revision !== expected)
    throw conflict(
      'DELIVERABLE_CHANGED',
      'This deliverable or review changed. Reload the latest state before trying again.',
    )
}
async function deliverableIn(tx: Db, p: Project, id: string) {
  const d = await tx.deliverable.findFirst({
    where: { id, projectId: p.id, organizationId: p.organizationId },
  })
  if (!d) throw notFound()
  return d
}
async function versionIn(tx: Db, did: string, id: string) {
  const v = await tx.deliverableVersion.findFirst({
    where: { id, deliverableId: did },
    include: versionInclude,
  })
  if (!v) throw notFound()
  return v
}
async function locked<T>(
  db: PrismaClient,
  org: string,
  pid: string,
  did: string,
  actor: Actor,
  run: (tx: Db, p: Project, d: Deliverable) => Promise<T>,
) {
  return lockedProject(db, org, pid, actor, async (tx, p) => {
    assertProjectWritable(p)
    return run(tx, p, await deliverableIn(tx, p, did))
  })
}
async function event(
  tx: Db,
  p: Project,
  did: string,
  actor: Actor,
  kind: Prisma.DeliverableEventCreateManyInput['kind'],
  number: number | null = null,
  reason = '',
  before: boolean | null = null,
  after: boolean | null = null,
) {
  const e = await tx.deliverableEvent.create({
    data: {
      projectId: p.id,
      organizationId: p.organizationId,
      deliverableId: did,
      actorId: actor.id,
      kind,
      versionNumber: number,
      reason,
      requiredBefore: before,
      requiredAfter: after,
    },
  })
  await tx.activityEvent.create({
    data: {
      organizationId: p.organizationId,
      actorId: actor.id,
      kind,
      targetId: e.id,
    },
  })
}
export async function createDeliverable(
  db: PrismaClient,
  org: string,
  pid: string,
  actor: Actor,
  input: z.infer<typeof deliverableCreateSchema>,
) {
  role(actor, 'OWNER')
  const { required, position, ...content } =
    deliverableCreateSchema.parse(input)
  return lockedProject(db, org, pid, actor, async (tx, p) => {
    assertProjectWritable(p)
    if ((await tx.deliverable.count({ where: { projectId: pid } })) >= 100)
      throw conflict(
        'DELIVERABLE_LIMIT',
        'Projects support up to 100 deliverables.',
      )
    const d = await tx.deliverable.create({
      data: { projectId: pid, organizationId: org, required, position },
    })
    const v = await tx.deliverableVersion.create({
      data: { ...content, deliverableId: d.id, number: 1 },
    })
    await event(
      tx,
      p,
      d.id,
      actor,
      'DELIVERABLE_CREATED',
      null,
      '',
      null,
      required,
    )
    return { deliverableId: d.id, versionId: v.id }
  })
}
export async function editMetadata(
  db: PrismaClient,
  org: string,
  pid: string,
  did: string,
  actor: Actor,
  input: z.infer<typeof deliverableMetadataSchema>,
  expected: number,
) {
  role(actor, 'OWNER')
  const data = deliverableMetadataSchema.parse(input)
  return locked(db, org, pid, did, actor, async (tx, p, d) => {
    revision(d, expected)
    if (d.required === data.required && d.position === data.position)
      return { deliverableId: did }
    await tx.deliverable.update({
      where: { id: did },
      data: { ...data, revision: { increment: 1 } },
    })
    await event(
      tx,
      p,
      did,
      actor,
      'DELIVERABLE_METADATA_CHANGED',
      null,
      '',
      d.required,
      data.required,
    )
    return { deliverableId: did }
  })
}
export async function draftVersion(
  db: PrismaClient,
  org: string,
  pid: string,
  did: string,
  actor: Actor,
  expected: number,
) {
  role(actor, 'OWNER')
  return locked(db, org, pid, did, actor, async (tx, _p, d) => {
    revision(d, expected)
    const latest = await tx.deliverableVersion.findFirstOrThrow({
      where: { deliverableId: did },
      orderBy: { number: 'desc' },
    })
    if (latest.state === 'DRAFT')
      throw conflict('DRAFT_EXISTS', 'Open the existing draft to continue.')
    if (latest.number >= 100)
      throw conflict(
        'VERSION_LIMIT',
        'Deliverables support up to 100 versions.',
      )
    const source = d.currentVersionId
      ? await versionIn(tx, did, d.currentVersionId)
      : latest
    const content = deliverableContentSchema.parse({
      title: source.title,
      description: source.description,
      links: source.links,
    })
    const v = await tx.deliverableVersion.create({
      data: { ...content, deliverableId: did, number: latest.number + 1 },
    })
    await tx.deliverable.update({
      where: { id: did },
      data: { revision: { increment: 1 } },
    })
    return { versionId: v.id }
  })
}
export async function editVersion(
  db: PrismaClient,
  org: string,
  pid: string,
  did: string,
  vid: string,
  actor: Actor,
  input: DeliverableContent,
  expected: number,
) {
  role(actor, 'OWNER')
  const content = deliverableContentSchema.parse(input)
  return locked(db, org, pid, did, actor, async (tx) => {
    const v = await versionIn(tx, did, vid)
    if (v.state !== 'DRAFT')
      throw conflict(
        'SNAPSHOT_IMMUTABLE',
        'Published snapshots cannot be edited. Create a revision draft.',
      )
    revision(v, expected)
    await tx.deliverableVersion.update({
      where: { id: vid },
      data: { ...content, revision: { increment: 1 } },
    })
    return { versionId: vid }
  })
}
export async function publishVersion(
  db: PrismaClient,
  org: string,
  pid: string,
  did: string,
  vid: string,
  actor: Actor,
  input: z.infer<typeof deliverablePublishSchema>,
) {
  role(actor, 'OWNER')
  const data = deliverablePublishSchema.parse(input)
  return locked(db, org, pid, did, actor, async (tx, p, d) => {
    const v = await versionIn(tx, did, vid)
    if (d.currentVersionId === vid && v.state === 'PUBLISHED')
      return { versionId: vid }
    revision(d, data.expectedDeliverableRevision)
    revision(v, data.expectedRevision)
    if (v.state !== 'DRAFT')
      throw conflict(
        'STALE_VERSION',
        'Only an editable draft can be published.',
      )
    const current = d.currentVersionId
      ? await versionIn(tx, did, d.currentVersionId)
      : null
    if (current?.decision?.outcome === 'ACCEPTED' && !data.reason)
      throw conflict(
        'REPLACEMENT_REASON_REQUIRED',
        'Replacing an accepted version requires a reason and fresh client acceptance.',
      )
    deliverableContentSchema.parse({
      title: v.title,
      description: v.description,
      links: v.links,
    })
    if (current?.state === 'PUBLISHED')
      await tx.deliverableVersion.update({
        where: { id: current.id },
        data: { state: 'SUPERSEDED' },
      })
    const changed = await tx.deliverableVersion.updateMany({
      where: {
        id: vid,
        deliverableId: did,
        state: 'DRAFT',
        revision: data.expectedRevision,
      },
      data: {
        state: 'PUBLISHED',
        publishedAt: new Date(),
        publicationReason: data.reason,
      },
    })
    if (!changed.count)
      throw conflict(
        'DELIVERABLE_CHANGED',
        'The draft changed. Reload before publishing.',
      )
    await tx.deliverable.update({
      where: { id: did },
      data: { currentVersionId: vid, revision: { increment: 1 } },
    })
    await event(
      tx,
      p,
      did,
      actor,
      current ? 'DELIVERABLE_REPLACED' : 'DELIVERABLE_PUBLISHED',
      v.number,
      data.reason,
    )
    return { versionId: vid }
  })
}
export async function withdrawVersion(
  db: PrismaClient,
  org: string,
  pid: string,
  did: string,
  vid: string,
  actor: Actor,
  expected: number,
  reason: string,
) {
  role(actor, 'OWNER')
  return locked(db, org, pid, did, actor, async (tx, p, d) => {
    revision(d, expected)
    const v = await versionIn(tx, did, vid)
    if (d.currentVersionId !== vid || v.state !== 'PUBLISHED' || v.decision)
      throw conflict(
        'STALE_VERSION',
        'Only the current undecided published version can be withdrawn.',
      )
    const changed = await tx.deliverableVersion.updateMany({
      where: {
        id: vid,
        deliverableId: did,
        state: 'PUBLISHED',
        decision: null,
      },
      data: { state: 'WITHDRAWN' },
    })
    if (!changed.count)
      throw conflict(
        'STALE_VERSION',
        'Another member decided on this version. Reload before trying again.',
      )
    await tx.deliverable.update({
      where: { id: did },
      data: { revision: { increment: 1 } },
    })
    await event(tx, p, did, actor, 'DELIVERABLE_WITHDRAWN', v.number, reason)
    return { versionId: vid }
  })
}
export async function decideVersion(
  db: PrismaClient,
  org: string,
  pid: string,
  did: string,
  vid: string,
  actor: Actor,
  input: z.infer<typeof deliverableDecisionSchema>,
) {
  role(actor, 'CLIENT')
  const data = deliverableDecisionSchema.parse(input)
  return locked(db, org, pid, did, actor, async (tx, p, d) => {
    const v = await versionIn(tx, did, vid)
    if (v.state === 'DRAFT') throw notFound()
    if (d.currentVersionId !== vid || v.state !== 'PUBLISHED')
      throw conflict(
        'STALE_VERSION',
        'This version is withdrawn or no longer current. Open the current version.',
      )
    if (v.decision) {
      if (
        v.decision.outcome === data.outcome &&
        v.decision.feedback === data.feedback
      )
        return { decision: versionDto(v).decision! }
      throw conflict(
        'DECISION_CONFLICT',
        'A different decision or feedback has already been recorded.',
      )
    }
    const changed = await tx.deliverableVersion.updateMany({
      where: {
        id: vid,
        deliverableId: did,
        state: 'PUBLISHED',
        decision: null,
      },
      data: { state: 'PUBLISHED' },
    })
    if (!changed.count)
      throw conflict(
        'STALE_VERSION',
        'The current version changed. Reload and review again.',
      )
    await tx.deliverableDecision.create({
      data: { versionId: vid, actorId: actor.id, ...data },
    })
    await tx.deliverable.update({
      where: { id: did },
      data: { revision: { increment: 1 } },
    })
    await event(tx, p, did, actor, 'DELIVERABLE_DECIDED', v.number)
    return { decision: versionDto(await versionIn(tx, did, vid)).decision! }
  })
}
const identity = { select: { id: true, name: true } } as const
const versionInclude = { decision: { include: { actor: identity } } } as const
type Version = Prisma.DeliverableVersionGetPayload<{
  include: typeof versionInclude
}>
function versionDto(v: Version) {
  return {
    id: v.id,
    number: v.number,
    revision: v.revision,
    state: v.state,
    ...deliverableContentSchema.parse({
      title: v.title,
      description: v.description,
      links: v.links,
    }),
    publishedAt: v.publishedAt?.toISOString() ?? null,
    publicationReason: v.publicationReason,
    decision: v.decision
      ? {
          id: v.decision.id,
          versionId: v.id,
          actor: v.decision.actor,
          outcome: v.decision.outcome,
          feedback: v.decision.feedback,
          createdAt: v.decision.createdAt.toISOString(),
        }
      : null,
  }
}
function dto(d: Deliverable, versions: Version[]) {
  const current = versions.find((v) => v.id === d.currentVersionId)
  const acceptance: DeliverableDto['acceptance'] =
    current?.state === 'WITHDRAWN'
      ? 'WITHDRAWN'
      : current?.state === 'PUBLISHED'
        ? (current.decision?.outcome ?? 'PENDING_REVIEW')
        : 'UNPUBLISHED'
  return {
    id: d.id,
    projectId: d.projectId,
    organizationId: d.organizationId,
    required: d.required,
    position: d.position,
    revision: d.revision,
    currentVersionId: d.currentVersionId,
    acceptance,
    versions: versions.map(versionDto),
  }
}
async function projectIn(tx: Db, org: string, pid: string, actor: Actor) {
  await scopedOrganization(tx, org, actor)
  const p = await tx.project.findFirst({
    where: { id: pid, organizationId: org },
  })
  if (!p) throw notFound()
  return p
}
export async function listDeliverables(
  db: PrismaClient,
  org: string,
  pid: string,
  actor: Actor,
) {
  return db.$transaction(
    async (tx) => {
      const p = await projectIn(tx, org, pid, actor),
        owner = actor.role === 'OWNER'
      const rows = await tx.deliverable.findMany({
        where: {
          projectId: pid,
          organizationId: org,
          ...(owner ? {} : { versions: { some: { state: { not: 'DRAFT' } } } }),
        },
        orderBy: { position: 'asc' },
        include: {
          versions: {
            where: owner ? {} : { state: { not: 'DRAFT' } },
            orderBy: { number: 'desc' },
            take: owner ? 2 : 1,
            include: versionInclude,
          },
        },
      })
      return {
        project: { id: pid, status: p.status, revision: p.lockRevision },
        deliverables: rows.map((d) => dto(d, d.versions)),
      }
    },
    { isolationLevel: 'RepeatableRead' },
  )
}
export async function readDeliverable(
  db: PrismaClient,
  org: string,
  pid: string,
  did: string,
  actor: Actor,
  page = 1,
) {
  return db.$transaction(
    async (tx) => {
      const p = await projectIn(tx, org, pid, actor),
        owner = actor.role === 'OWNER'
      const d = await tx.deliverable.findFirst({
        where: { id: did, projectId: pid, organizationId: org },
        include: {
          versions: {
            where: owner ? {} : { state: { not: 'DRAFT' } },
            orderBy: { number: 'desc' },
            include: versionInclude,
          },
          events: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * 50,
            take: 51,
            include: { actor: identity },
          },
        },
      })
      if (!d || !d.versions.length) throw notFound()
      // Draft creation/editing produces no client-visible history entries.
      return {
        page,
        hasMoreEvents: d.events.length > 50,
        project: { id: pid, status: p.status, revision: p.lockRevision },
        deliverable: {
          ...dto(d, d.versions),
          events: d.events.slice(0, 50).map((e) => ({
            id: e.id,
            kind: e.kind,
            versionNumber: e.versionNumber,
            reason: e.reason,
            requiredBefore: e.requiredBefore,
            requiredAfter: e.requiredAfter,
            actor: e.actor,
            createdAt: e.createdAt.toISOString(),
          })),
        },
      }
    },
    { isolationLevel: 'RepeatableRead' },
  )
}
