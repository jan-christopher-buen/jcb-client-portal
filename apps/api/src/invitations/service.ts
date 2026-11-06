import { createHash, randomBytes } from 'node:crypto'
import type { PrismaClient, Prisma } from '../generated/prisma/client.js'
import { HttpError } from '../errors.js'
import type { Mailer } from './mail.js'
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
export async function createInvitation(
  db: PrismaClient,
  mailer: Mailer,
  organizationId: string,
  email: string,
  actorId: string,
) {
  const token = randomBytes(32).toString('hex')
  const invitation = await serialTransaction(db, async (tx) => {
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
    const previous = await tx.invitation.findMany({
      where: { organizationId, email, acceptedAt: null, revokedAt: null },
      select: { id: true },
    })
    await tx.invitation.updateMany({
      where: { id: { in: previous.map((v) => v.id) } },
      data: { revokedAt: new Date() },
    })
    for (const prior of previous)
      await tx.activityEvent.create({
        data: {
          organizationId,
          actorId,
          kind: 'INVITATION_REVOKED',
          targetId: prior.id,
        },
      })
    const created = await tx.invitation.create({
      data: {
        organizationId,
        email,
        invitedBy: actorId,
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      },
    })
    await tx.activityEvent.create({
      data: {
        organizationId,
        actorId,
        kind: 'INVITATION_CREATED',
        targetId: created.id,
      },
    })
    return { ...created, organizationName: organization.name }
  })
  try {
    await mailer({ email, organization: invitation.organizationName, token })
    await db.invitation.update({
      where: { id: invitation.id },
      data: { deliveredAt: new Date() },
    })
  } catch {
    await db.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { deliveryFailed: true, revokedAt: new Date() },
      })
      await tx.activityEvent.create({
        data: {
          organizationId,
          actorId,
          kind: 'INVITATION_DELIVERY_FAILED',
          targetId: invitation.id,
        },
      })
    })
    throw new HttpError(
      502,
      'DELIVERY_FAILED',
      'Invitation delivery failed. Check the local mail sink and reissue the invitation.',
    )
  }
  return {
    id: invitation.id,
    email,
    expiresAt: invitation.expiresAt,
    delivery: 'sent',
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
