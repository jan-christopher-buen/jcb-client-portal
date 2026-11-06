import { Router, type Request } from 'express'
import { z } from 'zod'
import {
  projectTransitionSchema,
  milestoneInputSchema,
  milestoneEditSchema,
  milestoneActionSchema,
  reviewDecisionSchema,
} from '@jcb/contracts'
import type { PrismaClient } from '../generated/prisma/client.js'
import { requireUser, requireOwner } from '../auth/security.js'
import { uuid } from '../organizations/access.js'
import {
  readWorkflow,
  transitionProject,
  createMilestone,
  editMilestone,
  actMilestone,
  decideReview,
} from './service.js'
const ids = (req: Request) =>
  [uuid(req.params.orgId), uuid(req.params.projectId)] as const
export function projectRoutes(db: PrismaClient) {
  const router = Router({ mergeParams: true })
  router.use(requireUser())
  router.get('/projects/:projectId/workflow', async (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page ?? 1)
    res.json(await readWorkflow(db, ...ids(req), req.user!, page))
  })
  router.post(
    '/projects/:projectId/status',
    requireOwner(),
    async (req, res) => {
      res.json(
        await transitionProject(
          db,
          ...ids(req),
          req.user!,
          projectTransitionSchema.parse(req.body),
        ),
      )
    },
  )
  router.post(
    '/projects/:projectId/milestones',
    requireOwner(),
    async (req, res) => {
      res
        .status(201)
        .json(
          await createMilestone(
            db,
            ...ids(req),
            req.user!,
            milestoneInputSchema.parse(req.body),
          ),
        )
    },
  )
  router.patch(
    '/projects/:projectId/milestones/:milestoneId',
    requireOwner(),
    async (req, res) => {
      const { expectedRevision, ...input } = milestoneEditSchema.parse(req.body)
      res.json(
        await editMilestone(
          db,
          ...ids(req),
          uuid(req.params.milestoneId),
          req.user!,
          input,
          expectedRevision,
        ),
      )
    },
  )
  router.post(
    '/projects/:projectId/milestones/:milestoneId/actions',
    requireOwner(),
    async (req, res) => {
      res.json(
        await actMilestone(
          db,
          ...ids(req),
          uuid(req.params.milestoneId),
          req.user!,
          milestoneActionSchema.parse(req.body),
        ),
      )
    },
  )
  router.post(
    '/projects/:projectId/milestones/:milestoneId/reviews/:reviewId/decision',
    async (req, res) => {
      res.json(
        await decideReview(
          db,
          ...ids(req),
          uuid(req.params.milestoneId),
          uuid(req.params.reviewId),
          req.user!,
          reviewDecisionSchema.parse(req.body),
        ),
      )
    },
  )
  return router
}
