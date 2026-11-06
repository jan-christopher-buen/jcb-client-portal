import { Router } from 'express'
import { z } from 'zod'
import {
  contactSchema,
  contactUpdateSchema,
  organizationSchema,
  organizationUpdateSchema,
} from '@jcb/contracts'
import type { PrismaClient } from '../generated/prisma/client.js'
import { requireOwner, requireUser } from '../auth/security.js'
import { identitySelect } from '../auth/routes.js'
import { accessibleOrganization, uuid } from './access.js'
import { notFound } from '../errors.js'
export function organizationRoutes(db: PrismaClient) {
  const router = Router()
  router.use(requireUser())
  router.get('/', async (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page ?? 1)
    const limit = 20
    const rows = await db.organization.findMany({
      where:
        req.user!.role === 'OWNER'
          ? {}
          : {
              archivedAt: null,
              memberships: { some: { userId: req.user!.id, revokedAt: null } },
            },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit + 1,
      select: { id: true, name: true, createdAt: true, archivedAt: true },
    })
    res.json({
      organizations: rows.slice(0, limit),
      page,
      hasMore: rows.length > limit,
    })
  })
  router.post('/', requireOwner(), async (req, res) => {
    const organization = await db.organization.create({
      data: organizationSchema.parse(req.body),
    })
    res.status(201).json({ organization })
  })
  router.use('/:id', async (req, res, next) => {
    res.locals.organization = await accessibleOrganization(
      db,
      uuid(req.params.id),
      req.user!,
    )
    next()
  })
  router.get('/:id', async (req, res) => {
    const organization = res.locals.organization
    if (req.user!.role !== 'OWNER')
      return res.json({
        organization: {
          id: organization.id,
          name: organization.name,
          createdAt: organization.createdAt,
          archivedAt: organization.archivedAt,
        },
      })
    const id = uuid(req.params.id)
    const [contacts, memberships, invitations, activities] = await Promise.all([
      db.contact.findMany({
        where: { organizationId: id },
        orderBy: { name: 'asc' },
        take: 100,
        select: { id: true, name: true, email: true, archivedAt: true },
      }),
      db.membership.findMany({
        where: { organizationId: id },
        take: 100,
        orderBy: { createdAt: 'desc' },
        select: { id: true, revokedAt: true, user: { select: identitySelect } },
      }),
      db.invitation.findMany({
        where: { organizationId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          email: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
          deliveredAt: true,
          deliveryFailed: true,
        },
      }),
      db.activityEvent.findMany({
        where: { organizationId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          id: true,
          kind: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
      }),
    ])
    res.json({ organization, contacts, memberships, invitations, activities })
  })
  router.patch('/:id', requireOwner(), async (req, res) => {
    const { archived, ...data } = organizationUpdateSchema.parse(req.body)
    const organization = await db.organization.update({
      where: { id: uuid(req.params.id) },
      data: {
        ...data,
        ...(archived === undefined
          ? {}
          : { archivedAt: archived ? new Date() : null }),
      },
    })
    res.json({ organization })
  })
  router.post('/:id/contacts', requireOwner(), async (req, res) => {
    const contact = await db.contact.create({
      data: {
        ...contactSchema.parse(req.body),
        organizationId: uuid(req.params.id),
      },
    })
    res.status(201).json({ contact })
  })
  router.patch('/:id/contacts/:contactId', requireOwner(), async (req, res) => {
    const id = uuid(req.params.contactId),
      organizationId = uuid(req.params.id)
    const { archived, ...data } = contactUpdateSchema.parse(req.body)
    const result = await db.contact.updateMany({
      where: { id, organizationId },
      data: {
        ...data,
        ...(archived === undefined
          ? {}
          : { archivedAt: archived ? new Date() : null }),
      },
    })
    if (!result.count) throw notFound()
    res.status(204).end()
  })
  router.delete(
    '/:id/memberships/:membershipId',
    requireOwner(),
    async (req, res) => {
      const organizationId = uuid(req.params.id),
        id = uuid(req.params.membershipId)
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`
        const member = await tx.membership.findFirst({
          where: { id, organizationId },
        })
        if (!member) throw notFound()
        if (member.revokedAt) return
        await tx.membership.update({
          where: { id },
          data: { revokedAt: new Date() },
        })
        await tx.activityEvent.create({
          data: {
            organizationId,
            actorId: req.user!.id,
            kind: 'MEMBERSHIP_REVOKED',
            targetId: id,
          },
        })
      })
      res.status(204).end()
    },
  )
  return router
}
