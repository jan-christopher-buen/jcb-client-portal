import { z } from 'zod'
import {
  milestoneInputSchema,
  milestoneActionSchema,
  projectTransitionSchema,
  reviewDecisionSchema,
  manilaDate,
  milestoneOverdue,
  milestoneProgress,
  type MilestoneInput,
} from '@jcb/contracts'
import type {
  PrismaClient,
  Prisma,
  Project,
  Milestone,
} from '../generated/prisma/client.js'
import { HttpError, notFound } from '../errors.js'
import {
  serialTransaction,
  lockOrganization,
  scopedOrganization,
} from '../proposals/service.js'
type Db = Prisma.TransactionClient
type Actor = Express.User
const conflict = (code: string, message: string) =>
  new HttpError(409, code, message)
function owner(actor: Actor) {
  if (actor.role !== 'OWNER')
    throw new HttpError(403, 'FORBIDDEN', 'Owner access required.')
}
function writable(project: Project) {
  if (project.status === 'ON_HOLD' || project.status === 'CANCELLED')
    throw conflict(
      'PROJECT_PAUSED',
      'This project is on hold or cancelled. Workflow changes are unavailable.',
    )
}
async function locked<T>(
  db: PrismaClient,
  org: string,
  id: string,
  actor: Actor,
  run: (tx: Db, project: Project) => Promise<T>,
) {
  return serialTransaction(db, async (tx) => {
    await lockOrganization(tx, org, actor)
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${id}::uuid AND organization_id = ${org}::uuid FOR UPDATE`
    const project = await tx.project.findFirst({
      where: { id, organizationId: org },
    })
    if (!project) throw notFound()
    await tx.project.update({
      where: { id },
      data: { lockRevision: { increment: 1 } },
    })
    return run(tx, project)
  })
}
async function milestone(tx: Db, project: Project, id: string) {
  const row = await tx.milestone.findFirst({
    where: {
      id,
      projectId: project.id,
      organizationId: project.organizationId,
    },
  })
  if (!row) throw notFound()
  return row
}
function revision(row: { revision: number }, expected: number) {
  if (row.revision !== expected)
    throw conflict(
      'STALE_MILESTONE',
      'This milestone changed. Reload the latest state before trying again.',
    )
}
async function event(
  tx: Db,
  p: Project,
  actor: Actor,
  kind: Prisma.WorkflowEventCreateManyInput['kind'],
  fromState: string | null,
  toState: string,
  reason = '',
  milestoneId: string | null = null,
) {
  const row = await tx.workflowEvent.create({
    data: {
      projectId: p.id,
      organizationId: p.organizationId,
      actorId: actor.id,
      milestoneId,
      kind,
      fromState,
      toState,
      reason,
    },
  })
  await tx.activityEvent.create({
    data: {
      organizationId: p.organizationId,
      actorId: actor.id,
      kind,
      targetId: row.id,
    },
  })
}
export async function transitionProject(
  db: PrismaClient,
  org: string,
  id: string,
  actor: Actor,
  input: z.infer<typeof projectTransitionSchema>,
) {
  owner(actor)
  const data = projectTransitionSchema.parse(input)
  return locked(db, org, id, actor, async (tx, p) => {
    if (p.lockRevision !== data.expectedRevision)
      throw conflict(
        'STALE_PROJECT',
        'This project changed. Reload before changing its status.',
      )
    let status: Project['status'],
      resumeStatus: Project['resumeStatus'] = null
    if (data.action === 'RESUME' && p.status === 'ON_HOLD' && p.resumeStatus)
      status = p.resumeStatus
    else if (data.action === 'ACTIVATE' && p.status === 'PLANNED')
      status = 'ACTIVE'
    else if (data.action === 'REVIEW' && p.status === 'ACTIVE')
      status = 'IN_REVIEW'
    else if (
      data.action === 'HOLD' &&
      ['PLANNED', 'ACTIVE', 'IN_REVIEW'].includes(p.status)
    ) {
      status = 'ON_HOLD'
      resumeStatus = p.status
    } else if (data.action === 'CANCEL' && p.status !== 'CANCELLED')
      status = 'CANCELLED'
    else
      throw conflict(
        'INVALID_TRANSITION',
        'That project status transition is unavailable.',
      )
    await tx.project.update({ where: { id }, data: { status, resumeStatus } })
    await event(
      tx,
      p,
      actor,
      'PROJECT_STATUS_CHANGED',
      p.status,
      status,
      data.reason,
    )
    return { status, revision: p.lockRevision + 1 }
  })
}
export async function createMilestone(
  db: PrismaClient,
  org: string,
  id: string,
  actor: Actor,
  input: MilestoneInput,
) {
  owner(actor)
  const data = milestoneInputSchema.parse(input)
  return locked(db, org, id, actor, async (tx, p) => {
    writable(p)
    if ((await tx.milestone.count({ where: { projectId: id } })) >= 100)
      throw conflict(
        'MILESTONE_LIMIT',
        'Projects support up to 100 milestones.',
      )
    const row = await tx.milestone.create({
      data: {
        ...data,
        dueDate: data.dueDate ? new Date(`${data.dueDate}T00:00:00Z`) : null,
        projectId: id,
        organizationId: org,
      },
    })
    await event(tx, p, actor, 'MILESTONE_CREATED', null, 'PLANNED', '', row.id)
    return { milestoneId: row.id }
  })
}
export async function editMilestone(
  db: PrismaClient,
  org: string,
  id: string,
  mid: string,
  actor: Actor,
  input: MilestoneInput,
  expected: number,
) {
  owner(actor)
  const data = milestoneInputSchema.parse(input)
  return locked(db, org, id, actor, async (tx, p) => {
    writable(p)
    const m = await milestone(tx, p, mid)
    revision(m, expected)
    if (!['PLANNED', 'IN_PROGRESS'].includes(m.status))
      throw conflict(
        'SNAPSHOT_IMMUTABLE',
        'Withdraw the current review or reopen the accepted milestone before editing.',
      )
    await tx.milestone.update({
      where: { id: mid },
      data: {
        ...data,
        dueDate: data.dueDate ? new Date(`${data.dueDate}T00:00:00Z`) : null,
        revision: { increment: 1 },
      },
    })
    await event(tx, p, actor, 'MILESTONE_EDITED', m.status, m.status, '', mid)
    return { milestoneId: mid }
  })
}
export async function actMilestone(
  db: PrismaClient,
  org: string,
  id: string,
  mid: string,
  actor: Actor,
  input: z.infer<typeof milestoneActionSchema>,
) {
  owner(actor)
  const data = milestoneActionSchema.parse(input)
  return locked(db, org, id, actor, async (tx, p) => {
    writable(p)
    const m = await milestone(tx, p, mid)
    revision(m, data.expectedRevision)
    let status: Milestone['status'],
      kind: Prisma.WorkflowEventCreateManyInput['kind'],
      currentReviewId = m.currentReviewId
    if (data.action === 'START' && m.status === 'PLANNED') {
      status = 'IN_PROGRESS'
      kind = 'MILESTONE_STARTED'
    } else if (data.action === 'SUBMIT' && m.status === 'IN_PROGRESS') {
      const latest = await tx.milestoneReview.findFirst({
        where: { milestoneId: mid },
        orderBy: { number: 'desc' },
      })
      const number = (latest?.number ?? 0) + 1
      if (number > 100)
        throw conflict(
          'REVIEW_LIMIT',
          'Milestones support up to 100 review rounds.',
        )
      const round = await tx.milestoneReview.create({
        data: {
          milestoneId: mid,
          number,
          title: m.title,
          description: m.description,
          submittedBy: actor.id,
        },
      })
      currentReviewId = round.id
      status = 'IN_REVIEW'
      kind = 'MILESTONE_SUBMITTED'
    } else if (
      data.action === 'WITHDRAW' &&
      m.status === 'IN_REVIEW' &&
      m.currentReviewId
    ) {
      const changed = await tx.milestoneReview.updateMany({
        where: { id: m.currentReviewId, milestoneId: mid, status: 'PENDING' },
        data: {
          status: 'WITHDRAWN',
          withdrawnBy: actor.id,
          withdrawnAt: new Date(),
          withdrawalReason: data.reason,
        },
      })
      if (!changed.count)
        throw conflict(
          'STALE_REVIEW',
          'This review has already changed. Reload the milestone.',
        )
      status = 'IN_PROGRESS'
      kind = 'MILESTONE_WITHDRAWN'
      currentReviewId = null
    } else if (data.action === 'REOPEN' && m.status === 'ACCEPTED') {
      status = 'IN_PROGRESS'
      kind = 'MILESTONE_REOPENED'
      currentReviewId = null
    } else
      throw conflict(
        'INVALID_TRANSITION',
        'That milestone transition is unavailable.',
      )
    await tx.milestone.update({
      where: { id: mid },
      data: { status, currentReviewId, revision: { increment: 1 } },
    })
    await event(tx, p, actor, kind, m.status, status, data.reason, mid)
    return { milestoneId: mid, reviewId: currentReviewId }
  })
}
export async function decideReview(
  db: PrismaClient,
  org: string,
  id: string,
  mid: string,
  rid: string,
  actor: Actor,
  input: z.infer<typeof reviewDecisionSchema>,
) {
  if (actor.role !== 'CLIENT')
    throw new HttpError(
      403,
      'CLIENT_DECISION_REQUIRED',
      'Only an active client member may decide on a review.',
    )
  const data = reviewDecisionSchema.parse(input)
  return locked(db, org, id, actor, async (tx, p) => {
    writable(p)
    const m = await milestone(tx, p, mid)
    const round = await tx.milestoneReview.findFirst({
      where: { id: rid, milestoneId: mid },
    })
    if (!round) throw notFound()
    if (m.currentReviewId !== rid || round.status === 'WITHDRAWN')
      throw conflict(
        'STALE_REVIEW',
        'This round is no longer current. Reload the milestone.',
      )
    if (round.status !== 'PENDING') {
      if (round.status === data.outcome && round.feedback === data.feedback)
        return {
          reviewId: rid,
          outcome: round.status,
          decidedAt: round.decidedAt!.toISOString(),
        }
      throw conflict(
        'DECISION_CONFLICT',
        'A different decision or feedback has already been recorded.',
      )
    }
    if (m.status !== 'IN_REVIEW')
      throw conflict(
        'STALE_REVIEW',
        'This milestone is no longer awaiting review.',
      )
    const now = new Date()
    const changed = await tx.milestoneReview.updateMany({
      where: { id: rid, milestoneId: mid, status: 'PENDING' },
      data: {
        status: data.outcome,
        feedback: data.feedback,
        decisionActorId: actor.id,
        decidedAt: now,
      },
    })
    if (!changed.count)
      throw conflict(
        'STALE_REVIEW',
        'Another member decided on this round. Reload the milestone.',
      )
    const status = data.outcome === 'ACCEPTED' ? 'ACCEPTED' : 'IN_PROGRESS'
    await tx.milestone.update({
      where: { id: mid },
      data: { status, revision: { increment: 1 } },
    })
    await event(tx, p, actor, 'MILESTONE_DECIDED', m.status, status, '', mid)
    return {
      reviewId: rid,
      outcome: data.outcome,
      decidedAt: now.toISOString(),
    }
  })
}
const identity = { select: { id: true, name: true } } as const
export async function readWorkflow(
  db: PrismaClient,
  org: string,
  id: string,
  actor: Actor,
  page = 1,
) {
  // One repeatable snapshot for membership, project state, rounds and progress.
  return db.$transaction(
    async (tx) => {
      await scopedOrganization(tx, org, actor)
      const p = await tx.project.findFirst({
        where: { id, organizationId: org },
        include: {
          milestones: {
            orderBy: { position: 'asc' },
            include: {
              reviews: {
                orderBy: { number: 'desc' },
                include: {
                  submitter: identity,
                  decisionActor: identity,
                  withdrawer: identity,
                },
              },
            },
          },
          workflowEvents: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * 50,
            take: 51,
            include: { actor: identity },
          },
        },
      })
      if (!p) throw notFound()
      const today = manilaDate(new Date())
      return {
        project: {
          id,
          status: p.status,
          resumeStatus: p.resumeStatus,
          revision: p.lockRevision,
        },
        today,
        progress: milestoneProgress(p.milestones),
        hasMoreEvents: p.workflowEvents.length > 50,
        milestones: p.milestones.map((m) => ({
          id: m.id,
          projectId: id,
          organizationId: org,
          title: m.title,
          description: m.description,
          dueDate: m.dueDate?.toISOString().slice(0, 10) ?? null,
          required: m.required,
          position: m.position,
          status: m.status,
          revision: m.revision,
          currentReviewId: m.currentReviewId,
          overdue: milestoneOverdue(
            m.dueDate?.toISOString().slice(0, 10) ?? null,
            m.status,
            p.status,
            today,
          ),
          reviews: m.reviews.map((r) => ({
            id: r.id,
            number: r.number,
            title: r.title,
            description: r.description,
            status: r.status,
            submitter: r.submitter,
            submittedAt: r.submittedAt.toISOString(),
            decisionActor: r.decisionActor,
            decidedAt: r.decidedAt?.toISOString() ?? null,
            feedback: r.feedback,
            withdrawer: r.withdrawer,
            withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
            withdrawalReason: r.withdrawalReason,
          })),
        })),
        events: p.workflowEvents.slice(0, 50).map((e) => ({
          id: e.id,
          milestoneId: e.milestoneId,
          kind: e.kind,
          fromState: e.fromState,
          toState: e.toState,
          reason: e.reason,
          createdAt: e.createdAt.toISOString(),
          actor: e.actor,
        })),
      }
    },
    { isolationLevel: 'RepeatableRead' },
  )
}
