import { Router, type Request } from 'express'
import { z } from 'zod'
import {
  handoverItemSchema,
  handoverEditSchema,
  handoverCheckSchema,
  completionSchema,
  reopenProjectSchema,
} from '@jcb/contracts'
import type { PrismaClient } from '../generated/prisma/client.js'
import { requireUser, requireOwner } from '../auth/security.js'
import { uuid } from '../organizations/access.js'
import {
  readHandover,
  createItem,
  editItem,
  checkItem,
  completeProject,
  reopenProject,
} from './service.js'
const ids = (req: Request) =>
  [uuid(req.params.orgId), uuid(req.params.projectId)] as const
export function handoverRoutes(db: PrismaClient) {
  const r = Router({ mergeParams: true })
  r.use(requireUser())
  r.get('/handover', async (req, res) =>
    res.json(
      await readHandover(
        db,
        ...ids(req),
        req.user!,
        z.coerce
          .number()
          .int()
          .min(1)
          .max(10000)
          .parse(req.query.page ?? 1),
      ),
    ),
  )
  r.get('/completion-readiness', async (req, res) =>
    res.json(await readHandover(db, ...ids(req), req.user!, 1, true)),
  )
  r.post('/handover/items', requireOwner(), async (req, res) =>
    res
      .status(201)
      .json(
        await createItem(
          db,
          ...ids(req),
          req.user!,
          handoverItemSchema.parse(req.body),
        ),
      ),
  )
  r.patch('/handover/items/:itemId', requireOwner(), async (req, res) =>
    res.json(
      await editItem(
        db,
        ...ids(req),
        uuid(req.params.itemId),
        req.user!,
        handoverEditSchema.parse(req.body),
      ),
    ),
  )
  r.post('/handover/items/:itemId/check', requireOwner(), async (req, res) =>
    res.json(
      await checkItem(
        db,
        ...ids(req),
        uuid(req.params.itemId),
        req.user!,
        handoverCheckSchema.parse(req.body),
      ),
    ),
  )
  r.post('/complete', requireOwner(), async (req, res) => {
    const data = completionSchema.parse(req.body)
    res.json(
      await completeProject(db, ...ids(req), req.user!, data.expectedRevision),
    )
  })
  r.post('/reopen', requireOwner(), async (req, res) => {
    const data = reopenProjectSchema.parse(req.body)
    res.json(
      await reopenProject(
        db,
        ...ids(req),
        req.user!,
        data.expectedRevision,
        data.reason,
      ),
    )
  })
  return r
}
