import { z } from 'zod'
import { Router, type Request } from 'express'
import {
  deliverableCreateSchema,
  deliverableMetadataEditSchema,
  deliverableEditSchema,
  deliverablePublishSchema,
  deliverableWithdrawSchema,
  deliverableDecisionSchema,
  sendVersionSchema,
} from '@jcb/contracts'
import type { PrismaClient } from '../generated/prisma/client.js'
import { requireUser, requireOwner } from '../auth/security.js'
import { uuid } from '../organizations/access.js'
import {
  createDeliverable,
  editMetadata,
  draftVersion,
  editVersion,
  publishVersion,
  withdrawVersion,
  decideVersion,
  listDeliverables,
  readDeliverable,
} from './service.js'
const ids = (req: Request) =>
  [uuid(req.params.orgId), uuid(req.params.projectId)] as const
export function deliverableRoutes(db: PrismaClient) {
  const r = Router({ mergeParams: true })
  r.use(requireUser())
  r.get('/deliverables', async (req, res) =>
    res.json(await listDeliverables(db, ...ids(req), req.user!)),
  )
  r.post('/deliverables', requireOwner(), async (req, res) =>
    res
      .status(201)
      .json(
        await createDeliverable(
          db,
          ...ids(req),
          req.user!,
          deliverableCreateSchema.parse(req.body),
        ),
      ),
  )
  r.get('/deliverables/:deliverableId', async (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page ?? 1)
    res.json(
      await readDeliverable(
        db,
        ...ids(req),
        uuid(req.params.deliverableId),
        req.user!,
        page,
      ),
    )
  })
  r.patch('/deliverables/:deliverableId', requireOwner(), async (req, res) => {
    const { expectedRevision, ...input } = deliverableMetadataEditSchema.parse(
      req.body,
    )
    res.json(
      await editMetadata(
        db,
        ...ids(req),
        uuid(req.params.deliverableId),
        req.user!,
        input,
        expectedRevision,
      ),
    )
  })
  r.post(
    '/deliverables/:deliverableId/versions',
    requireOwner(),
    async (req, res) => {
      const { expectedRevision } = sendVersionSchema.parse(req.body)
      res
        .status(201)
        .json(
          await draftVersion(
            db,
            ...ids(req),
            uuid(req.params.deliverableId),
            req.user!,
            expectedRevision,
          ),
        )
    },
  )
  r.patch(
    '/deliverables/:deliverableId/versions/:versionId',
    requireOwner(),
    async (req, res) => {
      const { expectedRevision, ...input } = deliverableEditSchema.parse(
        req.body,
      )
      res.json(
        await editVersion(
          db,
          ...ids(req),
          uuid(req.params.deliverableId),
          uuid(req.params.versionId),
          req.user!,
          input,
          expectedRevision,
        ),
      )
    },
  )
  r.post(
    '/deliverables/:deliverableId/versions/:versionId/publish',
    requireOwner(),
    async (req, res) =>
      res.json(
        await publishVersion(
          db,
          ...ids(req),
          uuid(req.params.deliverableId),
          uuid(req.params.versionId),
          req.user!,
          deliverablePublishSchema.parse(req.body),
        ),
      ),
  )
  r.post(
    '/deliverables/:deliverableId/versions/:versionId/withdraw',
    requireOwner(),
    async (req, res) => {
      const { expectedRevision, reason } = deliverableWithdrawSchema.parse(
        req.body,
      )
      res.json(
        await withdrawVersion(
          db,
          ...ids(req),
          uuid(req.params.deliverableId),
          uuid(req.params.versionId),
          req.user!,
          expectedRevision,
          reason,
        ),
      )
    },
  )
  r.post(
    '/deliverables/:deliverableId/versions/:versionId/decision',
    async (req, res) =>
      res.json(
        await decideVersion(
          db,
          ...ids(req),
          uuid(req.params.deliverableId),
          uuid(req.params.versionId),
          req.user!,
          deliverableDecisionSchema.parse(req.body),
        ),
      ),
  )
  return r
}
