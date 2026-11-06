import { Router, type Request } from 'express'
import { z } from 'zod'
import {
  closeChangeSchema,
  changeRequestSchema,
  changeMessageSchema,
  changeOfferEditSchema,
  changeImplementSchema,
  sendVersionSchema,
  decisionSchema,
} from '@jcb/contracts'
import type { PrismaClient } from '../generated/prisma/client.js'
import { uuid } from '../organizations/access.js'
import { requireUser, requireOwner } from '../auth/security.js'
import {
  createChange,
  listChanges,
  abandonOffer,
  closeChange,
  readChange,
  addMessage,
  draftOffer,
  editOffer,
  publishOffer,
  decideOffer,
  implementChange,
} from './service.js'
const ids = (req: Request) =>
  [uuid(req.params.orgId), uuid(req.params.projectId)] as const
export function changeRoutes(db: PrismaClient) {
  const router = Router({ mergeParams: true })
  router.use(requireUser())
  router.get('/changes', async (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page ?? 1)
    res.json(await listChanges(db, ...ids(req), req.user!, page))
  })
  router.post('/changes', async (req, res) => {
    res
      .status(201)
      .json(
        await createChange(
          db,
          ...ids(req),
          req.user!,
          changeRequestSchema.parse(req.body),
        ),
      )
  })
  router.get('/changes/:requestId', async (req, res) => {
    res.json(
      await readChange(db, ...ids(req), uuid(req.params.requestId), req.user!),
    )
  })
  router.post('/changes/:requestId/messages', async (req, res) => {
    res
      .status(201)
      .json(
        await addMessage(
          db,
          ...ids(req),
          uuid(req.params.requestId),
          req.user!,
          changeMessageSchema.parse(req.body),
        ),
      )
  })
  router.post(
    '/changes/:requestId/offers',
    requireOwner(),
    async (req, res) => {
      const { expectedRevision } = sendVersionSchema.parse(req.body)
      res
        .status(201)
        .json(
          await draftOffer(
            db,
            ...ids(req),
            uuid(req.params.requestId),
            req.user!,
            expectedRevision,
          ),
        )
    },
  )
  router.patch(
    '/changes/:requestId/offers/:offerId',
    requireOwner(),
    async (req, res) => {
      const { expectedRevision, ...input } = changeOfferEditSchema.parse(
        req.body,
      )
      res.json(
        await editOffer(
          db,
          ...ids(req),
          uuid(req.params.requestId),
          uuid(req.params.offerId),
          req.user!,
          input,
          expectedRevision,
        ),
      )
    },
  )
  router.post(
    '/changes/:requestId/offers/:offerId/publish',
    requireOwner(),
    async (req, res) => {
      const { expectedRevision } = sendVersionSchema.parse(req.body)
      res.json(
        await publishOffer(
          db,
          ...ids(req),
          uuid(req.params.requestId),
          uuid(req.params.offerId),
          req.user!,
          expectedRevision,
        ),
      )
    },
  )
  router.post(
    '/changes/:requestId/offers/:offerId/decision',
    async (req, res) => {
      const { outcome } = decisionSchema.parse(req.body)
      res.json(
        await decideOffer(
          db,
          ...ids(req),
          uuid(req.params.requestId),
          uuid(req.params.offerId),
          req.user!,
          outcome,
        ),
      )
    },
  )
  router.post(
    '/changes/:requestId/implement',
    requireOwner(),
    async (req, res) => {
      const { expectedRevision, note } = changeImplementSchema.parse(req.body)
      res.json(
        await implementChange(
          db,
          ...ids(req),
          uuid(req.params.requestId),
          req.user!,
          expectedRevision,
          note,
        ),
      )
    },
  )
  router.post('/changes/:requestId/close', requireOwner(), async (req, res) => {
    const data = closeChangeSchema.parse(req.body)
    res.json(
      await closeChange(
        db,
        ...ids(req),
        uuid(req.params.requestId),
        req.user!,
        data.expectedRevision,
        data.reason,
      ),
    )
  })
  router.post(
    '/changes/:requestId/offers/:offerId/abandon',
    requireOwner(),
    async (req, res) => {
      const data = closeChangeSchema.parse(req.body)
      res.json(
        await abandonOffer(
          db,
          ...ids(req),
          uuid(req.params.requestId),
          uuid(req.params.offerId),
          req.user!,
          data.expectedRevision,
          data.reason,
        ),
      )
    },
  )
  return router
}
