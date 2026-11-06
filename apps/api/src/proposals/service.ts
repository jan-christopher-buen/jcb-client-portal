import { z } from 'zod'
import {
  proposalDraftSchema,
  proposalItemSchema,
  type ProposalDraft,
} from '@jcb/contracts'
import type { PrismaClient, Prisma } from '../generated/prisma/client.js'
import { HttpError, notFound } from '../errors.js'
import { calculateTotal } from './money.js'
type Db = Prisma.TransactionClient
type Actor = Express.User
export const versionInclude = {
  decision: { include: { actor: { select: { id: true, name: true } } } },
} as const
type Version = Prisma.ProposalVersionGetPayload<{
  include: typeof versionInclude
}>
const conflict = (code: string, message: string) =>
  new HttpError(409, code, message)
export function versionDto(version: Version, owner: boolean) {
  return {
    id: version.id,
    number: version.number,
    state: version.state,
    editRevision: version.editRevision,
    title: version.title,
    scope: version.scope,
    exclusions: version.exclusions,
    deliveryAssumptions: version.deliveryAssumptions,
    ...(owner ? { internalNotes: version.internalNotes } : {}),
    currency: 'PHP' as const,
    items: z.array(proposalItemSchema).parse(version.items),
    totalMinor: version.totalMinor.toString(),
    sentAt: version.sentAt?.toISOString() ?? null,
    decision: version.decision
      ? {
          id: version.decision.id,
          versionId: version.id,
          actor: version.decision.actor,
          outcome: version.decision.outcome,
          createdAt: version.decision.createdAt.toISOString(),
        }
      : null,
  }
}
export async function scopedOrganization(
  db: Db,
  organizationId: string,
  actor: Actor,
  write = false,
) {
  const org = await db.organization.findFirst({
    where: {
      id: organizationId,
      ...(actor.role === 'OWNER'
        ? {}
        : {
            archivedAt: null,
            memberships: {
              some: {
                userId: actor.id,
                revokedAt: null,
                user: { disabledAt: null },
              },
            },
          }),
    },
  })
  if (!org) throw notFound()
  if (write && org.archivedAt)
    throw conflict(
      'ORGANIZATION_ARCHIVED',
      'Restore the organization before changing proposals.',
    )
  return org
}
export async function serialTransaction<T>(
  db: PrismaClient,
  run: (tx: Db) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(run, {
        isolationLevel: 'Serializable',
        maxWait: 5000,
        timeout: 10000,
      })
    } catch (error) {
      const details = error as {
        code?: unknown
        meta?: {
          code?: unknown
          driverAdapterError?: { cause?: { originalCode?: unknown } }
        }
      } | null
      const code = details?.code
      const sqlCode =
        details?.meta?.code ??
        details?.meta?.driverAdapterError?.cause?.originalCode
      if (
        code !== 'P2034' &&
        !(code === 'P2010' && (sqlCode === '40001' || sqlCode === '40P01'))
      )
        throw error
      if (attempt === 3)
        throw conflict(
          'RETRY_REQUIRED',
          'Another request changed this proposal. Refresh and try again.',
        )
    }
  }
}
async function lockOrganization(tx: Db, id: string, actor: Actor) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${id}::uuid FOR UPDATE`
  // Force a serialization retry if disable/revocation committed while this
  // transaction was waiting on the organization lock.
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id}::uuid FOR SHARE`
  if (actor.role === 'CLIENT')
    await tx.$queryRaw`SELECT id FROM memberships WHERE organization_id = ${id}::uuid AND user_id = ${actor.id}::uuid FOR SHARE`
  const user = await tx.user.findFirst({
    where: { id: actor.id, disabledAt: null, role: actor.role },
  })
  if (!user)
    throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in again.')
  await scopedOrganization(tx, id, actor, true)
}
async function locked<T>(
  db: PrismaClient,
  orgId: string,
  id: string,
  actor: Actor,
  run: (tx: Db, proposal: Prisma.ProposalGetPayload<object>) => Promise<T>,
) {
  return serialTransaction(db, async (tx) => {
    await lockOrganization(tx, orgId, actor)
    await tx.$queryRaw`SELECT id FROM proposals WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid FOR UPDATE`
    const proposal = await tx.proposal.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!proposal) throw notFound()
    // A write makes waiting serializable transactions retry from a fresh snapshot.
    await tx.proposal.update({
      where: { id },
      data: { lockRevision: { increment: 1 } },
    })
    return run(tx, proposal)
  })
}
async function assertEditable(tx: Db, id: string) {
  if (
    await tx.proposalVersion.findFirst({
      where: { proposalId: id, state: 'APPROVED' },
      select: { id: true },
    })
  )
    throw conflict(
      'PROPOSAL_APPROVED',
      'Approved proposals are locked. Later scope changes require a change request.',
    )
}
function content(input: ProposalDraft) {
  const data = proposalDraftSchema.parse(input)
  return { ...data, totalMinor: calculateTotal(data) }
}
function ownerOnly(actor: Actor) {
  if (actor.role !== 'OWNER')
    throw new HttpError(403, 'FORBIDDEN', 'Owner access required.')
}
export async function createProposal(
  db: PrismaClient,
  orgId: string,
  actor: Actor,
  input: ProposalDraft,
) {
  ownerOnly(actor)
  const data = content(input)
  return serialTransaction(db, async (tx) => {
    await lockOrganization(tx, orgId, actor)
    const proposal = await tx.proposal.create({
      data: { organizationId: orgId },
    })
    const version = await tx.proposalVersion.create({
      data: {
        ...data,
        proposalId: proposal.id,
        organizationId: orgId,
        number: 1,
      },
    })
    await tx.activityEvent.create({
      data: {
        organizationId: orgId,
        actorId: actor.id,
        kind: 'PROPOSAL_CREATED',
        targetId: proposal.id,
      },
    })
    return { proposalId: proposal.id, versionId: version.id }
  })
}
export async function editDraft(
  db: PrismaClient,
  orgId: string,
  id: string,
  versionId: string,
  actor: Actor,
  input: ProposalDraft,
  expectedRevision: number,
) {
  ownerOnly(actor)
  const data = content(input)
  return locked(db, orgId, id, actor, async (tx) => {
    await assertEditable(tx, id)
    const version = await tx.proposalVersion.findFirst({
      where: { id: versionId, proposalId: id, organizationId: orgId },
    })
    if (!version) throw notFound()
    if (version.state !== 'DRAFT')
      throw conflict(
        'SNAPSHOT_IMMUTABLE',
        'Published versions cannot be edited. Create a revision draft.',
      )
    const result = await tx.proposalVersion.updateMany({
      where: { id: versionId, state: 'DRAFT', editRevision: expectedRevision },
      data: { ...data, editRevision: { increment: 1 } },
    })
    if (!result.count)
      throw conflict(
        'DRAFT_CHANGED',
        'This draft changed in another window. Reload before saving again.',
      )
    return { versionId }
  })
}
export async function reviseProposal(
  db: PrismaClient,
  orgId: string,
  id: string,
  actor: Actor,
) {
  ownerOnly(actor)
  return locked(db, orgId, id, actor, async (tx, proposal) => {
    await assertEditable(tx, id)
    if (
      await tx.proposalVersion.findFirst({
        where: { proposalId: id, state: 'DRAFT' },
      })
    )
      throw conflict(
        'DRAFT_EXISTS',
        'A revision draft already exists. Open it to continue.',
      )
    const latest = await tx.proposalVersion.findFirstOrThrow({
      where: { proposalId: id },
      orderBy: { number: 'desc' },
    })
    if (!proposal.publishedVersionId || latest.number >= 100)
      throw conflict(
        'REVISION_UNAVAILABLE',
        'A published version is required and proposals are limited to 100 versions.',
      )
    const source = await tx.proposalVersion.findUniqueOrThrow({
      where: { id: proposal.publishedVersionId },
    })
    const data = content(
      proposalDraftSchema.parse({
        title: source.title,
        scope: source.scope,
        exclusions: source.exclusions,
        deliveryAssumptions: source.deliveryAssumptions,
        internalNotes: source.internalNotes,
        currency: source.currency,
        items: source.items,
      }),
    )
    const version = await tx.proposalVersion.create({
      data: {
        ...data,
        proposalId: id,
        organizationId: orgId,
        number: latest.number + 1,
      },
    })
    return { versionId: version.id }
  })
}
export async function sendVersion(
  db: PrismaClient,
  orgId: string,
  id: string,
  versionId: string,
  actor: Actor,
  expectedRevision: number,
) {
  ownerOnly(actor)
  return locked(db, orgId, id, actor, async (tx, proposal) => {
    await assertEditable(tx, id)
    const version = await tx.proposalVersion.findFirst({
      where: { id: versionId, proposalId: id, organizationId: orgId },
    })
    if (!version) throw notFound()
    if (proposal.publishedVersionId === versionId && version.state === 'SENT')
      return { versionId }
    if (version.state !== 'DRAFT')
      throw conflict('STALE_VERSION', 'Only an editable draft may be sent.')
    if (version.editRevision !== expectedRevision)
      throw conflict(
        'DRAFT_CHANGED',
        'The draft changed. Reload and review it before sending.',
      )
    // Revalidate authoritative totals before publishing, never trust browser totals.
    const total = calculateTotal(
      proposalDraftSchema.parse({
        title: version.title,
        scope: version.scope,
        exclusions: version.exclusions,
        deliveryAssumptions: version.deliveryAssumptions,
        internalNotes: version.internalNotes,
        currency: version.currency,
        items: version.items,
      }),
    )
    if (total !== version.totalMinor)
      throw conflict('INVALID_TOTAL', 'Save the draft again before sending.')
    if (proposal.publishedVersionId) {
      const superseded = await tx.proposalVersion.updateMany({
        where: {
          id: proposal.publishedVersionId,
          proposalId: id,
          state: 'SENT',
        },
        data: { state: 'SUPERSEDED' },
      })
      if (superseded.count)
        await tx.activityEvent.create({
          data: {
            organizationId: orgId,
            actorId: actor.id,
            kind: 'PROPOSAL_SUPERSEDED',
            targetId: proposal.publishedVersionId,
          },
        })
    }
    const published = await tx.proposalVersion.updateMany({
      where: { id: versionId, state: 'DRAFT', editRevision: expectedRevision },
      data: { state: 'SENT', sentAt: new Date() },
    })
    if (!published.count)
      throw conflict(
        'DRAFT_CHANGED',
        'The draft changed. Reload and try again.',
      )
    await tx.proposal.update({
      where: { id },
      data: { publishedVersionId: versionId },
    })
    await tx.activityEvent.create({
      data: {
        organizationId: orgId,
        actorId: actor.id,
        kind: 'PROPOSAL_SENT',
        targetId: versionId,
      },
    })
    return { versionId }
  })
}
export async function decideVersion(
  db: PrismaClient,
  orgId: string,
  id: string,
  versionId: string,
  actor: Actor,
  outcome: 'APPROVED' | 'DECLINED',
) {
  if (actor.role !== 'CLIENT')
    throw new HttpError(
      403,
      'CLIENT_DECISION_REQUIRED',
      'Only an active client member may decide on a proposal.',
    )
  return locked(db, orgId, id, actor, async (tx, proposal) => {
    const version = await tx.proposalVersion.findFirst({
      where: {
        id: versionId,
        proposalId: id,
        organizationId: orgId,
        state: { not: 'DRAFT' },
      },
      include: versionInclude,
    })
    if (!version) throw notFound()
    if (proposal.publishedVersionId !== versionId)
      throw conflict(
        'STALE_VERSION',
        'This version is no longer current. Open the current published version.',
      )
    if (version.decision) {
      if (version.decision.outcome !== outcome)
        throw conflict(
          'DECISION_CONFLICT',
          'A different decision has already been recorded.',
        )
      const project = await tx.project.findUnique({
        where: { proposalId: id },
        select: { id: true },
      })
      return {
        decision: versionDto(version, false).decision!,
        projectId: project?.id ?? null,
      }
    }
    const changed = await tx.proposalVersion.updateMany({
      where: { id: versionId, state: 'SENT' },
      data: { state: outcome },
    })
    if (!changed.count)
      throw conflict(
        'STALE_VERSION',
        'This version can no longer receive a decision.',
      )
    await tx.proposalDecision.create({
      data: { versionId, actorId: actor.id, outcome },
    })
    const project =
      outcome === 'APPROVED'
        ? await tx.project.create({
            data: {
              organizationId: orgId,
              proposalId: id,
              approvedVersionId: versionId,
            },
          })
        : null
    const events: Prisma.ActivityEventCreateManyInput[] = [
      {
        organizationId: orgId,
        actorId: actor.id,
        kind: 'PROPOSAL_DECIDED',
        targetId: versionId,
      },
    ]
    if (project)
      events.push({
        organizationId: orgId,
        actorId: actor.id,
        kind: 'PROJECT_CREATED',
        targetId: project.id,
      })
    await tx.activityEvent.createMany({ data: events })
    const recorded = await tx.proposalVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: versionInclude,
    })
    return {
      decision: versionDto(recorded, false).decision!,
      projectId: project?.id ?? null,
    }
  })
}
export async function readProposal(
  db: Db,
  orgId: string,
  id: string,
  actor: Actor,
) {
  await scopedOrganization(db, orgId, actor)
  const owner = actor.role === 'OWNER'
  const proposal = await db.proposal.findFirst({
    where: { id, organizationId: orgId },
    include: {
      versions: {
        where: owner ? {} : { state: { not: 'DRAFT' } },
        orderBy: { number: 'desc' },
        include: versionInclude,
      },
      projects: { select: { id: true } },
    },
  })
  if (!proposal || !proposal.versions.length) throw notFound()
  return {
    id,
    organizationId: orgId,
    publishedVersionId: proposal.publishedVersionId,
    approved: proposal.versions.some((v) => v.state === 'APPROVED'),
    projectId: proposal.projects[0]?.id ?? null,
    versions: proposal.versions.map((v) => versionDto(v, owner)),
  }
}
export async function readProject(
  db: Db,
  orgId: string,
  id: string,
  actor: Actor,
) {
  await scopedOrganization(db, orgId, actor)
  const project = await db.project.findFirst({
    where: { id, organizationId: orgId },
    include: { approvedVersion: { include: versionInclude } },
  })
  if (!project) throw notFound()
  return {
    id: project.id,
    organizationId: orgId,
    proposalId: project.proposalId,
    status: project.status,
    createdAt: project.createdAt.toISOString(),
    approvedVersion: versionDto(
      project.approvedVersion,
      actor.role === 'OWNER',
    ),
  }
}
