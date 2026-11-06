import { z } from 'zod'
import {
  changeRequestSchema,
  changeMessageSchema,
  changeOfferSchema,
  revisedAgreement,
  type ChangeRequestInput,
  type ChangeOfferInput,
  type AgreedAmounts,
} from '@jcb/contracts'
import type {
  PrismaClient,
  Prisma,
  Project,
  ChangeRequest,
} from '../generated/prisma/client.js'
import { lockedProject, assertProjectWritable } from '../projects/service.js'
import { scopedOrganization } from '../proposals/service.js'
import { handoverEvent } from '../handover/audit.js'
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
function editable(request: ChangeRequest) {
  if (['APPROVED', 'IMPLEMENTED', 'CLOSED'].includes(request.state))
    throw conflict(
      'CHANGE_APPROVED',
      'Approved changes are locked. Create a separate change request for further scope changes.',
    )
}
function revision(request: { revision: number }, expected: number) {
  if (request.revision !== expected)
    throw conflict(
      'CHANGE_CHANGED',
      'This record changed. Reload and review the latest state before trying again.',
    )
}
async function requestIn(tx: Db, project: Project, id: string) {
  const row = await tx.changeRequest.findFirst({
    where: {
      id,
      projectId: project.id,
      organizationId: project.organizationId,
    },
  })
  if (!row) throw notFound()
  return row
}
async function offerIn(tx: Db, requestId: string, id: string) {
  const row = await tx.changeOffer.findFirst({ where: { id, requestId } })
  if (!row) throw notFound()
  return row
}
async function locked<T>(
  db: PrismaClient,
  org: string,
  pid: string,
  rid: string,
  actor: Actor,
  run: (tx: Db, p: Project, r: ChangeRequest) => Promise<T>,
) {
  return lockedProject(db, org, pid, actor, async (tx, p) => {
    assertProjectWritable(p)
    const r = await requestIn(tx, p, rid)
    if (r.state === 'CLOSED')
      throw conflict(
        'CHANGE_CLOSED',
        'This change request was explicitly closed.',
      )
    return run(tx, p, r)
  })
}
async function activity(
  tx: Db,
  p: Project,
  actor: Actor,
  kind: Prisma.ActivityEventCreateManyInput['kind'],
  targetId: string,
) {
  await tx.activityEvent.create({
    data: {
      organizationId: p.organizationId,
      actorId: actor.id,
      kind,
      targetId,
    },
  })
}
export async function agreedAmounts(
  tx: Db,
  p: Project,
): Promise<AgreedAmounts> {
  const original = await tx.proposalVersion.findFirstOrThrow({
    where: {
      id: p.approvedVersionId,
      proposalId: p.proposalId,
      organizationId: p.organizationId,
    },
  })
  const offers = await tx.changeOffer.findMany({
    where: {
      request: { projectId: p.id, organizationId: p.organizationId },
      state: 'APPROVED',
      decision: { outcome: 'APPROVED' },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { request: { select: { id: true, title: true } } },
  })
  return {
    ...revisedAgreement(
      original.totalMinor,
      offers.map((o) => o.adjustmentMinor),
    ),
    approvedChanges: offers.map((o) => ({
      requestId: o.requestId,
      offerId: o.id,
      title: o.request.title,
      number: o.number,
      adjustmentMinor: o.adjustmentMinor.toString(),
    })),
  }
}
export async function createChange(
  db: PrismaClient,
  org: string,
  pid: string,
  actor: Actor,
  input: ChangeRequestInput,
) {
  role(actor, 'CLIENT')
  const data = changeRequestSchema.parse(input)
  return lockedProject(db, org, pid, actor, async (tx, p) => {
    assertProjectWritable(p)
    if ((await tx.changeRequest.count({ where: { projectId: pid } })) >= 100)
      throw conflict(
        'CHANGE_LIMIT',
        'Projects support up to 100 change requests.',
      )
    const r = await tx.changeRequest.create({
      data: {
        ...data,
        projectId: pid,
        organizationId: org,
        createdBy: actor.id,
      },
    })
    await activity(tx, p, actor, 'CHANGE_REQUESTED', r.id)
    return { requestId: r.id }
  })
}
export async function addMessage(
  db: PrismaClient,
  org: string,
  pid: string,
  rid: string,
  actor: Actor,
  input: z.infer<typeof changeMessageSchema>,
) {
  const data = changeMessageSchema.parse(input)
  role(actor, data.kind === 'RESPONSE' ? 'CLIENT' : 'OWNER')
  return locked(db, org, pid, rid, actor, async (tx, p, r) => {
    revision(r, data.expectedRevision)
    if (r.state === 'CLOSED')
      throw conflict(
        'CHANGE_CLOSED',
        'This change request was explicitly closed.',
      )
    let state = r.state
    if (data.kind !== 'OWNER_NOTE') {
      editable(r)
      if (
        data.kind === 'CLARIFICATION' &&
        ['OPEN', 'NEEDS_CLARIFICATION', 'DECLINED'].includes(r.state)
      )
        state = 'NEEDS_CLARIFICATION'
      else if (data.kind === 'RESPONSE' && r.state === 'NEEDS_CLARIFICATION')
        state = 'OPEN'
      else
        throw conflict(
          'INVALID_TRANSITION',
          'Clarification requires an open or declined request without a pending offer; a response requires a clarification request.',
        )
    }
    if ((await tx.changeMessage.count({ where: { requestId: rid } })) >= 100)
      throw conflict(
        'DISCUSSION_LIMIT',
        'Requests support up to 100 discussion entries, including owner notes.',
      )
    const message = await tx.changeMessage.create({
      data: {
        requestId: rid,
        actorId: actor.id,
        kind: data.kind,
        body: data.body,
      },
    })
    await tx.changeRequest.update({
      where: { id: rid },
      data: { state, revision: { increment: 1 } },
    })
    if (data.kind !== 'OWNER_NOTE')
      await activity(
        tx,
        p,
        actor,
        data.kind === 'RESPONSE' ? 'CHANGE_RESPONDED' : 'CHANGE_CLARIFICATION',
        message.id,
      )
    return { messageId: message.id }
  })
}
export async function draftOffer(
  db: PrismaClient,
  org: string,
  pid: string,
  rid: string,
  actor: Actor,
  expected: number,
) {
  role(actor, 'OWNER')
  return locked(db, org, pid, rid, actor, async (tx, _p, r) => {
    editable(r)
    revision(r, expected)
    const latest = await tx.changeOffer.findFirst({
      where: { requestId: rid },
      orderBy: { number: 'desc' },
    })
    if (latest?.state === 'DRAFT')
      throw conflict(
        'DRAFT_EXISTS',
        'Open the existing offer draft to continue.',
      )
    if ((latest?.number ?? 0) >= 100)
      throw conflict(
        'OFFER_LIMIT',
        'Requests support up to 100 offer versions.',
      )
    const source = r.publishedOfferId
      ? await offerIn(tx, rid, r.publishedOfferId)
      : null
    const offer = await tx.changeOffer.create({
      data: {
        requestId: rid,
        number: (latest?.number ?? 0) + 1,
        scope: source?.scope ?? r.requestedChange,
        exclusions: source?.exclusions ?? '',
        adjustmentMinor: source?.adjustmentMinor ?? 0n,
        scheduleImpact: source?.scheduleImpact ?? 'No schedule impact.',
      },
    })
    await tx.changeRequest.update({
      where: { id: rid },
      data: { revision: { increment: 1 } },
    })
    return { offerId: offer.id }
  })
}
export async function editOffer(
  db: PrismaClient,
  org: string,
  pid: string,
  rid: string,
  oid: string,
  actor: Actor,
  input: ChangeOfferInput,
  expected: number,
) {
  role(actor, 'OWNER')
  const data = changeOfferSchema.parse(input)
  return locked(db, org, pid, rid, actor, async (tx, _p, r) => {
    editable(r)
    const offer = await offerIn(tx, rid, oid)
    if (offer.state !== 'DRAFT')
      throw conflict(
        'SNAPSHOT_IMMUTABLE',
        'Published offers cannot be edited. Create a new draft.',
      )
    revision(offer, expected)
    await tx.changeOffer.update({
      where: { id: oid },
      data: {
        ...data,
        adjustmentMinor: BigInt(data.adjustmentMinor),
        revision: { increment: 1 },
      },
    })
    return { offerId: oid }
  })
}
export async function publishOffer(
  db: PrismaClient,
  org: string,
  pid: string,
  rid: string,
  oid: string,
  actor: Actor,
  expected: number,
) {
  role(actor, 'OWNER')
  return locked(db, org, pid, rid, actor, async (tx, p, r) => {
    editable(r)
    const offer = await offerIn(tx, rid, oid)
    if (offer.state === 'PUBLISHED' && r.publishedOfferId === oid)
      return { offerId: oid }
    if (r.state === 'NEEDS_CLARIFICATION')
      throw conflict(
        'CLARIFICATION_PENDING',
        'Wait for the client clarification response before publishing.',
      )
    if (offer.state !== 'DRAFT')
      throw conflict('STALE_OFFER', 'Only an editable draft can be published.')
    revision(offer, expected)
    changeOfferSchema.parse({
      scope: offer.scope,
      exclusions: offer.exclusions,
      scheduleImpact: offer.scheduleImpact,
      adjustmentMinor: offer.adjustmentMinor.toString(),
    })
    if (r.publishedOfferId) {
      const previous = await tx.changeOffer.updateMany({
        where: { id: r.publishedOfferId, requestId: rid, state: 'PUBLISHED' },
        data: { state: 'SUPERSEDED' },
      })
      if (previous.count)
        await activity(
          tx,
          p,
          actor,
          'CHANGE_OFFER_SUPERSEDED',
          r.publishedOfferId,
        )
    }
    const changed = await tx.changeOffer.updateMany({
      where: { id: oid, requestId: rid, state: 'DRAFT', revision: expected },
      data: { state: 'PUBLISHED', publishedAt: new Date() },
    })
    if (!changed.count)
      throw conflict(
        'CHANGE_CHANGED',
        'The offer changed. Reload before publishing.',
      )
    await tx.changeRequest.update({
      where: { id: rid },
      data: {
        publishedOfferId: oid,
        state: 'OFFERED',
        revision: { increment: 1 },
      },
    })
    await activity(tx, p, actor, 'CHANGE_OFFER_PUBLISHED', oid)
    return { offerId: oid }
  })
}
const identity = { select: { id: true, name: true } } as const
const offerInclude = { decision: { include: { actor: identity } } } as const
function offerDto(
  o: Prisma.ChangeOfferGetPayload<{ include: typeof offerInclude }>,
) {
  return {
    id: o.id,
    number: o.number,
    revision: o.revision,
    state: o.state,
    scope: o.scope,
    exclusions: o.exclusions,
    adjustmentMinor: o.adjustmentMinor.toString(),
    scheduleImpact: o.scheduleImpact,
    publishedAt: o.publishedAt?.toISOString() ?? null,
    decision: o.decision
      ? {
          id: o.decision.id,
          versionId: o.id,
          actor: o.decision.actor,
          outcome: o.decision.outcome,
          createdAt: o.decision.createdAt.toISOString(),
        }
      : null,
  }
}
export async function decideOffer(
  db: PrismaClient,
  org: string,
  pid: string,
  rid: string,
  oid: string,
  actor: Actor,
  outcome: 'APPROVED' | 'DECLINED',
) {
  role(actor, 'CLIENT')
  return locked(db, org, pid, rid, actor, async (tx, p, r) => {
    const offer = await tx.changeOffer.findFirst({
      where: {
        id: oid,
        requestId: rid,
        state: { notIn: ['DRAFT', 'ABANDONED'] },
      },
      include: offerInclude,
    })
    if (!offer) throw notFound()
    if (r.publishedOfferId !== oid)
      throw conflict(
        'STALE_OFFER',
        'This offer is no longer current. Reload the current published version.',
      )
    if (offer.decision) {
      if (offer.decision.outcome !== outcome)
        throw conflict(
          'DECISION_CONFLICT',
          'A different decision has already been recorded.',
        )
      return {
        decision: offerDto(offer).decision!,
        amounts: await agreedAmounts(tx, p),
      }
    }
    if (offer.state !== 'PUBLISHED' || r.state !== 'OFFERED')
      throw conflict(
        'STALE_OFFER',
        'This offer can no longer receive a decision.',
      )
    if (outcome === 'APPROVED') {
      const current = await agreedAmounts(tx, p)
      try {
        revisedAgreement(BigInt(current.originalMinor), [
          ...current.approvedChanges.map((o) => BigInt(o.adjustmentMinor)),
          offer.adjustmentMinor,
        ])
      } catch {
        throw conflict(
          'AGREED_AMOUNT_BOUNDS',
          'Approval would make the revised agreed amount negative or exceed the supported maximum. Ask the owner for a replacement offer.',
        )
      }
    }
    const changed = await tx.changeOffer.updateMany({
      where: { id: oid, requestId: rid, state: 'PUBLISHED' },
      data: { state: outcome },
    })
    if (!changed.count)
      throw conflict(
        'STALE_OFFER',
        'Another request changed this offer. Reload and review again.',
      )
    await tx.changeDecision.create({
      data: { offerId: oid, actorId: actor.id, outcome },
    })
    await tx.changeRequest.update({
      where: { id: rid },
      data: { state: outcome, revision: { increment: 1 } },
    })
    await activity(tx, p, actor, 'CHANGE_DECIDED', oid)
    const saved = await tx.changeOffer.findUniqueOrThrow({
      where: { id: oid },
      include: offerInclude,
    })
    return {
      decision: offerDto(saved).decision!,
      amounts: await agreedAmounts(tx, p),
    }
  })
}
export async function implementChange(
  db: PrismaClient,
  org: string,
  pid: string,
  rid: string,
  actor: Actor,
  expected: number,
  note: string,
) {
  role(actor, 'OWNER')
  return locked(db, org, pid, rid, actor, async (tx, p, r) => {
    revision(r, expected)
    if (r.state !== 'APPROVED')
      throw conflict(
        'INVALID_TRANSITION',
        'Only an approved change can be marked implemented.',
      )
    const changed = await tx.changeRequest.updateMany({
      where: { id: rid, state: 'APPROVED', revision: expected },
      data: {
        state: 'IMPLEMENTED',
        implementationNote: note,
        implementedBy: actor.id,
        implementedAt: new Date(),
        revision: { increment: 1 },
      },
    })
    if (!changed.count)
      throw conflict(
        'CHANGE_CHANGED',
        'This request changed. Reload before recording implementation.',
      )
    await activity(tx, p, actor, 'CHANGE_IMPLEMENTED', rid)
    return { requestId: rid }
  })
}
async function projectIn(tx: Db, org: string, pid: string, actor: Actor) {
  await scopedOrganization(tx, org, actor)
  const p = await tx.project.findFirst({
    where: { id: pid, organizationId: org },
  })
  if (!p) throw notFound()
  return p
}
const projectDto = (p: Project) => ({
  id: p.id,
  status: p.status,
  revision: p.lockRevision,
})
export async function listChanges(
  db: PrismaClient,
  org: string,
  pid: string,
  actor: Actor,
  page: number,
) {
  return db.$transaction(
    async (tx) => {
      const p = await projectIn(tx, org, pid, actor)
      const rows = await tx.changeRequest.findMany({
        where: { projectId: pid, organizationId: org },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20,
        take: 21,
        select: {
          id: true,
          title: true,
          state: true,
          publishedOfferId: true,
          createdAt: true,
        },
      })
      return {
        requests: rows
          .slice(0, 20)
          .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        amounts: await agreedAmounts(tx, p),
        project: projectDto(p),
        page,
        hasMore: rows.length > 20,
      }
    },
    { isolationLevel: 'RepeatableRead' },
  )
}
export async function readChange(
  db: PrismaClient,
  org: string,
  pid: string,
  rid: string,
  actor: Actor,
) {
  return db.$transaction(
    async (tx) => {
      const p = await projectIn(tx, org, pid, actor)
      const r = await tx.changeRequest.findFirst({
        where: { id: rid, projectId: pid, organizationId: org },
        include: {
          creator: identity,
          implementer: identity,
          messages: {
            where:
              actor.role === 'OWNER' ? {} : { kind: { not: 'OWNER_NOTE' } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: { actor: identity },
          },
          offers: {
            where:
              actor.role === 'OWNER'
                ? {}
                : { state: { notIn: ['DRAFT', 'ABANDONED'] } },
            orderBy: { number: 'desc' },
            include: offerInclude,
          },
        },
      })
      if (!r) throw notFound()
      return {
        request: {
          id: r.id,
          projectId: pid,
          organizationId: org,
          title: r.title,
          requestedChange: r.requestedChange,
          businessContext: r.businessContext,
          state: r.state,
          revision: r.revision,
          creator: r.creator,
          createdAt: r.createdAt.toISOString(),
          publishedOfferId: r.publishedOfferId,
          implementationNote: r.implementationNote,
          implementedAt: r.implementedAt?.toISOString() ?? null,
          implementer: r.implementer,
          messages: r.messages.map((m) => ({
            id: m.id,
            kind: m.kind,
            body: m.body,
            actor: m.actor,
            createdAt: m.createdAt.toISOString(),
          })),
          offers: r.offers.map(offerDto),
        },
        amounts: await agreedAmounts(tx, p),
        project: projectDto(p),
      }
    },
    { isolationLevel: 'RepeatableRead' },
  )
}

export async function closeChange(
  db: PrismaClient,
  org: string,
  pid: string,
  rid: string,
  actor: Actor,
  expected: number,
  reason: string,
) {
  role(actor, 'OWNER')
  return locked(db, org, pid, rid, actor, async (tx, p, r) => {
    revision(r, expected)
    editable(r)
    await tx.changeOffer.updateMany({
      where: { requestId: rid, state: 'DRAFT' },
      data: { state: 'ABANDONED' },
    })
    await tx.changeOffer.updateMany({
      where: { requestId: rid, state: 'PUBLISHED' },
      data: { state: 'SUPERSEDED' },
    })
    await tx.changeRequest.update({
      where: { id: rid },
      data: { state: 'CLOSED', revision: { increment: 1 } },
    })
    await handoverEvent(tx, p, actor, 'CHANGE_CLOSED', rid, reason, {
      from: r.state,
      to: 'CLOSED',
    })
    return { requestId: rid }
  })
}

export async function abandonOffer(
  db: PrismaClient,
  org: string,
  pid: string,
  rid: string,
  oid: string,
  actor: Actor,
  expected: number,
  reason: string,
) {
  role(actor, 'OWNER')
  return locked(db, org, pid, rid, actor, async (tx, p, _r) => {
    const offer = await offerIn(tx, rid, oid)
    revision(offer, expected)
    if (offer.state !== 'DRAFT')
      throw conflict(
        'STALE_OFFER',
        'Only an unpublished draft can be abandoned.',
      )
    await tx.changeOffer.update({
      where: { id: oid },
      data: { state: 'ABANDONED' },
    })
    await tx.changeRequest.update({
      where: { id: rid },
      data: { revision: { increment: 1 } },
    })
    await handoverEvent(tx, p, actor, 'CHANGE_CLOSED', rid, reason, {
      action: 'Unpublished offer draft explicitly abandoned',
    })
    return { offerId: oid }
  })
}
