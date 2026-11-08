import { createHash, randomBytes } from 'node:crypto'
import type { PrismaClient, Prisma } from '../generated/prisma/client.js'
import { HttpError } from '../errors.js'
import { DeliveryError, type Mailer } from './mail.js'
import { randomUUID } from 'node:crypto'
import { hashPassword } from '../auth/password.js'
import { identitySelect } from '../auth/routes.js'
import { serialTransaction } from '../transactions.js'
type Tx = Prisma.TransactionClient
const unavailable = () =>
  new HttpError(
    410,
    'INVITATION_UNAVAILABLE',
    'This invitation is invalid, expired, revoked, or already used. Ask the owner for a new invitation.',
  )
export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex')
async function validInvitation(tx: Tx | PrismaClient, token: string) {
  const invitation = await tx.invitation.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { organization: true },
  })
  if (
    !invitation ||
    invitation.revokedAt ||
    invitation.acceptedAt ||
    invitation.expiresAt <= new Date() ||
    invitation.organization.archivedAt
  )
    throw unavailable()
  return invitation
}
export async function inspectInvitation(db: PrismaClient, token: string) {
  const invitation = await validInvitation(db, token)
  return {
    email: invitation.email,
    organization: invitation.organization.name,
    accountExists: !!(await db.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    })),
  }
}
export function deliveryState(invitation: {
  deliveryState: string
  sendDeadline: Date | null
}) {
  return invitation.deliveryState === 'sending' &&
    (!invitation.sendDeadline || invitation.sendDeadline <= new Date())
    ? 'unconfirmed'
    : invitation.deliveryState
}
export async function createInvitation(
  db: PrismaClient,
  mailer: Mailer,
  organizationId: string,
  email: string,
  actorId: string,
  requestKey: string = randomUUID(),
  policy: {
    validate?: () => void
    cooldown?: boolean
    reissueConfirmed?: boolean
  } = {},
) {
  const attempt = await serialTransaction(
    db,
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actorId}, 0))::text`
      const prior = await tx.invitation.findUnique({
        where: { invitedBy_requestKey: { invitedBy: actorId, requestKey } },
      })
      if (prior) {
        if (prior.organizationId !== organizationId || prior.email !== email)
          throw new HttpError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This request key belongs to different invitation input.',
          )
        if (
          deliveryState(prior) === 'unconfirmed' &&
          prior.deliveryState === 'sending'
        )
          await tx.invitation.updateMany({
            where: {
              id: prior.id,
              deliveryState: 'sending',
              sendDeadline: { lte: new Date() },
            },
            data: { deliveryState: 'unconfirmed' },
          })
        return {
          invitation: { ...prior, deliveryState: deliveryState(prior) },
          token: null,
          organization: '',
        }
      }
      policy.validate?.()
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`
      const organization = await tx.organization.findUnique({
        where: { id: organizationId },
      })
      if (!organization || organization.archivedAt)
        throw new HttpError(
          409,
          'ORGANIZATION_ARCHIVED',
          'Restore the organization before inviting contacts.',
        )
      if (policy.cooldown) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${email}, 1))::text`
        if (
          await tx.invitation.findFirst({
            where: { email, createdAt: { gt: new Date(Date.now() - 60000) } },
          })
        )
          throw new HttpError(
            429,
            'RECIPIENT_COOLDOWN',
            'Wait one minute before deliberately reissuing to this recipient.',
          )
      }
      const previous = await tx.invitation.findMany({
        where: { organizationId, email, acceptedAt: null, revokedAt: null },
        select: { id: true },
      })
      if (previous.length && policy.reissueConfirmed === false)
        throw new HttpError(
          409,
          'REISSUE_CONFIRMATION_REQUIRED',
          'An earlier invitation exists. Confirm deliberate reissue before replacing it.',
        )
      await tx.invitation.updateMany({
        where: { id: { in: previous.map((v) => v.id) } },
        data: { revokedAt: new Date() },
      })
      for (const old of previous)
        await tx.activityEvent.create({
          data: {
            organizationId,
            actorId,
            kind: 'INVITATION_REVOKED',
            targetId: old.id,
          },
        })
      // Generate only after the duplicate check. Neither token nor body is persisted.
      const token = randomBytes(32).toString('hex')
      const invitation = await tx.invitation.create({
        data: {
          organizationId,
          email,
          invitedBy: actorId,
          requestKey,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + 72 * 3600000),
          deliveryState: 'sending',
          sendDeadline: new Date(Date.now() + 30000),
        },
      })
      await tx.activityEvent.create({
        data: {
          organizationId,
          actorId,
          kind: 'INVITATION_CREATED',
          targetId: invitation.id,
        },
      })
      return { invitation, token, organization: organization.name }
    },
    'ReadCommitted',
  )
  if (attempt.token) {
    let outcome: 'accepted' | 'failed' | 'unconfirmed' = 'unconfirmed'
    let providerMessageId: string | undefined
    try {
      const result = await mailer({
        email,
        organization: attempt.organization,
        token: attempt.token,
        invitationId: attempt.invitation.id,
      })
      outcome = 'accepted'
      providerMessageId = result?.id
    } catch (error) {
      outcome =
        error instanceof DeliveryError && !error.ambiguous
          ? 'failed'
          : 'unconfirmed'
    }
    try {
      await serialTransaction(db, async (tx) => {
        const updated = await tx.invitation.updateMany({
          where: {
            id: attempt.invitation.id,
            deliveryState: 'sending',
            revokedAt: null,
            acceptedAt: null,
            sendDeadline: { gt: new Date() },
          },
          data: {
            deliveryState: outcome,
            providerMessageId,
            ...(outcome === 'accepted' ? { deliveredAt: new Date() } : {}),
            ...(outcome === 'failed'
              ? { deliveryFailed: true, revokedAt: new Date() }
              : {}),
          },
        })
        if (updated.count && outcome === 'failed')
          await tx.activityEvent.create({
            data: {
              organizationId,
              actorId,
              kind: 'INVITATION_DELIVERY_FAILED',
              targetId: attempt.invitation.id,
            },
          })
      })
    } catch {
      // Provider acceptance and its database bookkeeping are separate boundaries.
      // A lost acknowledgement must never revoke a possibly delivered token.
      return {
        id: attempt.invitation.id,
        email,
        expiresAt: attempt.invitation.expiresAt,
        delivery: 'unconfirmed',
      }
    }
  }
  const current = await db.invitation.findUniqueOrThrow({
    where: { id: attempt.invitation.id },
  })
  return {
    id: current.id,
    email,
    expiresAt: current.expiresAt,
    delivery:
      current.deliveryState === 'failed'
        ? 'failed'
        : current.revokedAt
          ? 'revoked'
          : current.acceptedAt
            ? 'consumed'
            : deliveryState(current),
  }
}
export async function acceptInvitation(
  db: PrismaClient,
  input: { token: string; name?: string; password?: string },
  actor?: Express.User,
) {
  // Hash outside the transaction so row locks do not cover expensive password work.
  const initial = await validInvitation(db, input.token)
  if (actor && actor.email !== initial.email)
    throw new HttpError(
      403,
      'EMAIL_MISMATCH',
      'Sign in with the invited email to accept this invitation.',
    )
  const existing = await db.user.findUnique({ where: { email: initial.email } })
  if (existing && !actor)
    throw new HttpError(
      401,
      'SIGN_IN_REQUIRED',
      'Sign in with the invited email before accepting.',
    )
  if (!existing && (!input.password || !input.name))
    throw new HttpError(
      400,
      'ACCOUNT_DETAILS_REQUIRED',
      'Enter your name and a password of 12–128 characters.',
    )
  const passwordHash = !existing
    ? await hashPassword(input.password!)
    : undefined
  return serialTransaction(db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${initial.organizationId}::uuid FOR UPDATE`
    const invitation = await validInvitation(tx, input.token)
    let user = await tx.user.findUnique({ where: { email: invitation.email } })
    if (user) {
      if (
        !actor ||
        actor.id !== user.id ||
        actor.email !== invitation.email ||
        user.disabledAt
      )
        throw new HttpError(
          403,
          'EMAIL_MISMATCH',
          'Sign in with the invited email to accept this invitation.',
        )
    } else {
      if (actor || !passwordHash || !input.name)
        throw new HttpError(
          409,
          'ACCOUNT_CHANGED',
          'Reload the invitation and sign in if an account now exists.',
        )
      user = await tx.user.create({
        data: {
          email: invitation.email,
          name: input.name,
          passwordHash,
          role: 'CLIENT',
        },
      })
    }
    const consumed = await tx.invitation.updateMany({
      where: {
        id: invitation.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { acceptedAt: new Date() },
    })
    if (!consumed.count) throw unavailable()
    const previousMembership = await tx.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: invitation.organizationId,
          userId: user.id,
        },
      },
    })
    const membership = await tx.membership.upsert({
      where: {
        organizationId_userId: {
          organizationId: invitation.organizationId,
          userId: user.id,
        },
      },
      create: { organizationId: invitation.organizationId, userId: user.id },
      update: { revokedAt: null },
    })
    const events: Prisma.ActivityEventCreateManyInput[] = [
      {
        organizationId: invitation.organizationId,
        actorId: user.id,
        kind: 'INVITATION_ACCEPTED',
        targetId: invitation.id,
      },
    ]
    if (!previousMembership || previousMembership.revokedAt)
      events.push({
        organizationId: invitation.organizationId,
        actorId: user.id,
        kind: 'MEMBERSHIP_ACTIVATED',
        targetId: membership.id,
      })
    await tx.activityEvent.createMany({ data: events })

    return {
      user: await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: identitySelect,
      }),
      organizationId: invitation.organizationId,
    }
  })
}
