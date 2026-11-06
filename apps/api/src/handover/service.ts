import { z } from 'zod'
import {
  handoverItemSchema,
  handoverEditSchema,
  handoverCheckSchema,
  type CompletionSnapshot,
  type CompletionBlocker,
  type HandoverItemDto,
} from '@jcb/contracts'
import type {
  PrismaClient,
  Prisma,
  Project,
} from '../generated/prisma/client.js'
import { lockedProject, assertProjectWritable } from '../projects/service.js'
import { scopedOrganization } from '../proposals/service.js'
import { HttpError, notFound } from '../errors.js'
import { handoverEvent } from './audit.js'
type Db = Prisma.TransactionClient
type Actor = Express.User
const identity = { select: { id: true, name: true } } as const
const conflict = (code: string, message: string) =>
  new HttpError(409, code, message)
function owner(actor: Actor) {
  if (actor.role !== 'OWNER')
    throw new HttpError(403, 'FORBIDDEN', 'Owner access required.')
}
function revision(actual: number, expected: number) {
  if (actual !== expected)
    throw conflict(
      'HANDOVER_CHANGED',
      'This project or checklist changed. Reload the latest state before trying again.',
    )
}
const itemInclude = { completer: identity } as const
function itemDto(
  i: Prisma.HandoverItemGetPayload<{ include: typeof itemInclude }>,
): HandoverItemDto {
  return {
    id: i.id,
    title: i.title,
    description: i.description,
    required: i.required,
    clientVisible: i.clientVisible,
    position: i.position,
    revision: i.revision,
    completedAt: i.completedAt?.toISOString() ?? null,
    completer: i.completer,
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
// This deliberately reads ALL authoritative rows. Display pagination never enters readiness.
export async function evaluateReadiness(tx: Db, p: Project, actor: Actor) {
  const [milestones, deliverables, changes, items] = await Promise.all([
    tx.milestone.findMany({
      where: { projectId: p.id, organizationId: p.organizationId },
      orderBy: { position: 'asc' },
      include: { currentReview: true },
    }),
    tx.deliverable.findMany({
      where: { projectId: p.id, organizationId: p.organizationId },
      orderBy: { position: 'asc' },
      include: { currentVersion: { include: { decision: true } } },
    }),
    tx.changeRequest.findMany({
      where: { projectId: p.id, organizationId: p.organizationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        offers: { where: { state: 'DRAFT' }, select: { id: true } },
        publishedOffer: { include: { decision: true } },
      },
    }),
    tx.handoverItem.findMany({
      where: { projectId: p.id, organizationId: p.organizationId },
      orderBy: { position: 'asc' },
      include: itemInclude,
    }),
  ])
  const base = `/organizations/${p.organizationId}/projects/${p.id}`,
    blockers: CompletionBlocker[] = []
  const add = (code: string, message: string, path = base + '/handover') =>
    blockers.push({ code, message, path })
  if (p.status !== 'IN_REVIEW')
    add(
      'PROJECT_NOT_IN_REVIEW',
      `Project must be In review; current status is ${p.status.toLowerCase().replaceAll('_', ' ')}.`,
      base,
    )
  if (!milestones.some((m) => m.required))
    add(
      'NO_REQUIRED_MILESTONES',
      'At least one required milestone must exist.',
      base,
    )
  for (const m of milestones.filter((m) => m.required))
    if (
      m.status !== 'ACCEPTED' ||
      !m.currentReviewId ||
      m.currentReview?.status !== 'ACCEPTED'
    )
      add(
        'MILESTONE_NOT_ACCEPTED',
        `Required milestone “${m.title}” needs current client acceptance.`,
        `${base}/milestones/${m.id}`,
      )
  if (!deliverables.some((d) => d.required))
    add(
      'NO_REQUIRED_DELIVERABLES',
      'At least one required deliverable must exist.',
      base,
    )
  for (const d of deliverables.filter((d) => d.required))
    if (
      d.currentVersion?.state !== 'PUBLISHED' ||
      d.currentVersion.decision?.outcome !== 'ACCEPTED'
    ) {
      // A private draft title/id must not leak through a client readiness response.
      const visible = !!d.currentVersion
      add(
        'DELIVERABLE_NOT_ACCEPTED',
        visible
          ? `Required deliverable “${d.currentVersion!.title}” needs acceptance of its current published version.`
          : 'A required deliverable has not been published for client review.',
        visible ? `${base}/deliverables/${d.id}` : base,
      )
    }
  for (const r of changes) {
    const approved =
      r.publishedOffer?.state === 'APPROVED' &&
      r.publishedOffer.decision?.outcome === 'APPROVED'
    if (r.offers.length)
      add(
        'CHANGE_DRAFT_PENDING',
        `Change “${r.title}” has an unfinished offer draft; publish it or explicitly abandon it.`,
        `${base}/changes/${r.id}`,
      )
    if (r.state === 'IMPLEMENTED' && approved) continue
    if (r.state === 'CLOSED') continue // Explicit reasoned closure; abandoned drafts remain owner-only history.
    if (
      r.state === 'DECLINED' &&
      r.offers.length === 0 &&
      r.publishedOffer?.state === 'DECLINED'
    )
      continue
    add(
      r.state === 'APPROVED' ? 'CHANGE_NOT_IMPLEMENTED' : 'CHANGE_UNRESOLVED',
      r.state === 'APPROVED'
        ? `Approved change “${r.title}” must be marked implemented.`
        : `Change “${r.title}” is unresolved; finish it or explicitly close it.`,
      `${base}/changes/${r.id}`,
    )
  }
  if (!items.some((i) => i.required))
    add(
      'NO_REQUIRED_CHECKLIST',
      'At least one required handover checklist item must exist.',
    )
  for (const i of items.filter((i) => i.required && !i.completedAt))
    add(
      'CHECKLIST_INCOMPLETE',
      actor.role === 'OWNER' || i.clientVisible
        ? `Required checklist item “${i.title}” is incomplete.`
        : 'An owner-only required checklist item is incomplete.',
    )
  const snapshot: CompletionSnapshot = {
    milestones: milestones.map((m) => ({
      id: m.id,
      title: m.title,
      required: m.required,
      status: m.status,
      reviewId: m.currentReviewId,
      round: m.currentReview?.number ?? null,
    })),
    deliverables: deliverables.map((d) => ({
      id: d.id,
      title: d.currentVersion?.title ?? 'Unpublished deliverable',
      required: d.required,
      versionId: d.currentVersionId,
      number: d.currentVersion?.number ?? null,
      decisionId: d.currentVersion?.decision?.id ?? null,
      outcome: d.currentVersion?.decision?.outcome ?? null,
    })),
    changes: changes.map((r) => ({
      id: r.id,
      title: r.title,
      state: r.state,
      offerId: r.publishedOfferId,
      implementationNote: r.implementationNote,
      implementedAt: r.implementedAt?.toISOString() ?? null,
    })),
    checklist: items.map(itemDto),
  }
  return {
    ready: blockers.length === 0,
    blockers,
    snapshot,
    items: items.map(itemDto),
  }
}
export async function createItem(
  db: PrismaClient,
  org: string,
  pid: string,
  actor: Actor,
  input: z.infer<typeof handoverItemSchema>,
) {
  owner(actor)
  const data = handoverItemSchema.parse(input)
  return lockedProject(db, org, pid, actor, async (tx, p) => {
    assertProjectWritable(p)
    if ((await tx.handoverItem.count({ where: { projectId: pid } })) >= 100)
      throw conflict(
        'CHECKLIST_LIMIT',
        'Projects support up to 100 handover checklist items.',
      )
    const item = await tx.handoverItem.create({
      data: { ...data, projectId: pid, organizationId: org },
      include: itemInclude,
    })
    await handoverEvent(
      tx,
      p,
      actor,
      'HANDOVER_CREATED',
      item.id,
      '',
      { after: itemDto(item) },
      item.clientVisible,
    )
    return { itemId: item.id }
  })
}
export async function editItem(
  db: PrismaClient,
  org: string,
  pid: string,
  iid: string,
  actor: Actor,
  input: z.infer<typeof handoverEditSchema>,
) {
  owner(actor)
  const { expectedRevision, reason, ...data } = handoverEditSchema.parse(input)
  return lockedProject(db, org, pid, actor, async (tx, p) => {
    assertProjectWritable(p)
    const item = await tx.handoverItem.findFirst({
      where: { id: iid, projectId: pid, organizationId: org },
      include: itemInclude,
    })
    if (!item) throw notFound()
    revision(item.revision, expectedRevision)
    // Editing task content invalidates its completion; a fresh check records the new task.
    const edited = await tx.handoverItem.update({
      where: { id: iid },
      data: {
        ...data,
        completedAt: null,
        completedBy: null,
        revision: { increment: 1 },
      },
      include: itemInclude,
    })
    await handoverEvent(
      tx,
      p,
      actor,
      item.required !== data.required
        ? 'REQUIRED_FLAG_CHANGED'
        : 'HANDOVER_EDITED',
      iid,
      reason,
      { before: itemDto(item), after: itemDto(edited) },
      item.clientVisible && edited.clientVisible,
    )
    return { itemId: iid }
  })
}
export async function checkItem(
  db: PrismaClient,
  org: string,
  pid: string,
  iid: string,
  actor: Actor,
  input: z.infer<typeof handoverCheckSchema>,
) {
  owner(actor)
  const data = handoverCheckSchema.parse(input)
  return lockedProject(db, org, pid, actor, async (tx, p) => {
    assertProjectWritable(p)
    const item = await tx.handoverItem.findFirst({
      where: { id: iid, projectId: pid, organizationId: org },
      include: itemInclude,
    })
    if (!item) throw notFound()
    revision(item.revision, data.expectedRevision)
    if (!!item.completedAt === data.completed) return { itemId: iid }
    const edited = await tx.handoverItem.update({
      where: { id: iid },
      data: {
        completedAt: data.completed ? new Date() : null,
        completedBy: data.completed ? actor.id : null,
        revision: { increment: 1 },
      },
      include: itemInclude,
    })
    await handoverEvent(
      tx,
      p,
      actor,
      'HANDOVER_CHECKED',
      iid,
      data.reason,
      { before: itemDto(item), after: itemDto(edited) },
      item.clientVisible,
    )
    return { itemId: iid }
  })
}
export async function completeProject(
  db: PrismaClient,
  org: string,
  pid: string,
  actor: Actor,
  expected: number,
) {
  owner(actor)
  return lockedProject(db, org, pid, actor, async (tx, p) => {
    if (p.status === 'COMPLETED') {
      const saved = await tx.projectCompletion.findFirstOrThrow({
        where: { projectId: pid },
        orderBy: { cycle: 'desc' },
      })
      return {
        completionId: saved.id,
        completedAt: saved.completedAt.toISOString(),
      }
    }
    revision(p.lockRevision, expected)
    const readiness = await evaluateReadiness(tx, p, actor)
    if (!readiness.ready)
      throw conflict(
        'COMPLETION_BLOCKED',
        'Project is not ready for completion. Reload readiness to see current blockers.',
      )
    const last = await tx.projectCompletion.findFirst({
        where: { projectId: pid },
        orderBy: { cycle: 'desc' },
      }),
      now = new Date()
    const record = await tx.projectCompletion.create({
      data: {
        projectId: pid,
        organizationId: org,
        cycle: (last?.cycle ?? 0) + 1,
        actorId: actor.id,
        completedAt: now,
        snapshot: readiness.snapshot as unknown as Prisma.InputJsonValue,
      },
    })
    await tx.project.update({
      where: { id: pid },
      data: { status: 'COMPLETED', completedAt: now },
    })
    await handoverEvent(tx, p, actor, 'PROJECT_COMPLETED', record.id, '', {
      cycle: record.cycle,
    })
    return { completionId: record.id, completedAt: now.toISOString() }
  })
}
export async function reopenProject(
  db: PrismaClient,
  org: string,
  pid: string,
  actor: Actor,
  expected: number,
  reason: string,
) {
  owner(actor)
  return lockedProject(db, org, pid, actor, async (tx, p) => {
    revision(p.lockRevision, expected)
    if (p.status !== 'COMPLETED')
      throw conflict(
        'INVALID_TRANSITION',
        'Only a completed project can be explicitly reopened.',
      )
    await tx.project.update({
      where: { id: pid },
      data: { status: 'IN_REVIEW', completedAt: null },
    })
    await handoverEvent(tx, p, actor, 'PROJECT_REOPENED', pid, reason, {
      from: 'COMPLETED',
      to: 'IN_REVIEW',
    })
    return { status: 'IN_REVIEW' }
  })
}
export async function readHandover(
  db: PrismaClient,
  org: string,
  pid: string,
  actor: Actor,
  page = 1,
  onlyReadiness = false,
) {
  return db.$transaction(
    async (tx) => {
      const p = await projectIn(tx, org, pid, actor),
        evaluated = await evaluateReadiness(tx, p, actor),
        ownerView = actor.role === 'OWNER'
      const base = {
        project: { id: pid, status: p.status, revision: p.lockRevision },
        ready: evaluated.ready,
        blockers: evaluated.blockers,
      }
      if (onlyReadiness) return base
      const [completions, events] = await Promise.all([
        tx.projectCompletion.findMany({
          where: { projectId: pid, organizationId: org },
          orderBy: { cycle: 'desc' },
          include: { actor: identity },
        }),
        tx.handoverEvent.findMany({
          where: {
            projectId: pid,
            organizationId: org,
            ...(ownerView ? {} : { clientVisible: true }),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * 50,
          take: 51,
          include: { actor: identity },
        }),
      ])
      return {
        ...base,
        items: evaluated.items.filter((i) => ownerView || i.clientVisible),
        page,
        hasMoreEvents: events.length > 50,
        completions: completions.map((c) => {
          const snapshot = c.snapshot as unknown as CompletionSnapshot
          return {
            id: c.id,
            cycle: c.cycle,
            actor: c.actor,
            completedAt: c.completedAt.toISOString(),
            snapshot: {
              ...snapshot,
              deliverables: ownerView
                ? snapshot.deliverables
                : snapshot.deliverables.filter((d) => d.versionId !== null),
              checklist: snapshot.checklist.filter(
                (i) => ownerView || i.clientVisible,
              ),
            },
          }
        }),
        events: events.slice(0, 50).map((e) => ({
          id: e.id,
          kind: e.kind,
          targetId: e.targetId,
          reason: e.reason,
          details: e.details,
          actor: e.actor,
          createdAt: e.createdAt.toISOString(),
        })),
      }
    },
    { isolationLevel: 'RepeatableRead' },
  )
}
