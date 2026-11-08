import { Router } from 'express'
import {
  acceptInvitationSchema,
  inspectInvitationSchema,
  inviteSchema,
} from '@jcb/contracts'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { Config } from '../config.js'
import { validateInvitationDelivery, type Mailer } from './mail.js'
import { requireOwner, throttle } from '../auth/security.js'
import { establishSession } from '../auth/routes.js'
import { accessibleOrganization, uuid } from '../organizations/access.js'
import {
  acceptInvitation,
  createInvitation,
  inspectInvitation,
} from './service.js'
export function invitationRoutes(
  db: PrismaClient,
  config: Config,
  mailer: Mailer,
) {
  const router = Router()
  router.post(
    '/organizations/:id/invitations',
    requireOwner(),
    throttle(db, config.SESSION_SECRET, 'invite-send', 30),
    async (req, res) => {
      const id = uuid(req.params.id)
      await accessibleOrganization(db, id, req.user!)
      const input = inviteSchema.parse(req.body)
      res.status(201).json({
        invitation: await createInvitation(
          db,
          mailer,
          id,
          input.email,
          req.user!.id,
          input.requestKey,
          {
            validate: () => validateInvitationDelivery(config, input.email),
            cooldown: config.INVITATION_MAIL_MODE === 'resend',
            reissueConfirmed: input.reissueConfirmed,
          },
        ),
      })
    },
  )
  router.use(
    '/invitations',
    throttle(db, config.SESSION_SECRET, 'invite-accept', 30),
  )
  router.post('/invitations/inspect', async (req, res) => {
    const { token } = inspectInvitationSchema.parse(req.body)
    res.json(await inspectInvitation(db, token))
  })
  router.post('/invitations/accept', async (req, res) => {
    const result = await acceptInvitation(
      db,
      acceptInvitationSchema.parse(req.body),
      req.user,
    )
    await establishSession(req, result.user)
    res.json(result)
  })
  return router
}
