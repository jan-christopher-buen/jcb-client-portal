import { Router, type Request } from 'express'
import { z } from 'zod'
import {
  proposalDraftSchema,
  draftUpdateSchema,
  sendVersionSchema,
  decisionSchema,
} from '@jcb/contracts'
import type { PrismaClient } from '../generated/prisma/client.js'
import { requireUser, requireOwner } from '../auth/security.js'
import { uuid } from '../organizations/access.js'
import {
  createProposal,
  editDraft,
  reviseProposal,
  sendVersion,
  decideVersion,
  readProposal,
  readProject,
  scopedOrganization,
} from './service.js'
const organizationId = (req: Request) => uuid(req.params.orgId)
export function proposalRoutes(db: PrismaClient) {
  const router = Router({ mergeParams: true })
  router.use(requireUser())
  router.get('/proposals', async (req, res) => {
    const orgId = organizationId(req),
      actor = req.user!
    await scopedOrganization(db, orgId, actor)
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page ?? 1)
    const versions =
      actor.role === 'OWNER' ? {} : { state: { not: 'DRAFT' as const } }
    const rows = await db.proposal.findMany({
      where: { organizationId: orgId, versions: { some: versions } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * 20,
      take: 21,
      include: {
        versions: {
          where: versions,
          orderBy: { number: 'desc' },
          take: 1,
          select: { title: true, number: true, state: true },
        },
        projects: { select: { id: true } },
      },
    })
    res.json({
      proposals: rows.slice(0, 20).map((p) => ({
        id: p.id,
        ...p.versions[0],
        publishedVersionId: p.publishedVersionId,
        projectId: p.projects[0]?.id ?? null,
      })),
      page,
      hasMore: rows.length > 20,
    })
  })
  router.post('/proposals', requireOwner(), async (req, res) => {
    res
      .status(201)
      .json(
        await createProposal(
          db,
          organizationId(req),
          req.user!,
          proposalDraftSchema.parse(req.body),
        ),
      )
  })
  router.get('/proposals/:proposalId', async (req, res) => {
    res.json({
      proposal: await readProposal(
        db,
        organizationId(req),
        uuid(req.params.proposalId),
        req.user!,
      ),
    })
  })
  router.post(
    '/proposals/:proposalId/versions',
    requireOwner(),
    async (req, res) => {
      z.object({})
        .strict()
        .parse(req.body ?? {})
      res
        .status(201)
        .json(
          await reviseProposal(
            db,
            organizationId(req),
            uuid(req.params.proposalId),
            req.user!,
          ),
        )
    },
  )
  router.patch(
    '/proposals/:proposalId/versions/:versionId',
    requireOwner(),
    async (req, res) => {
      const { expectedRevision, ...input } = draftUpdateSchema.parse(req.body)
      res.json(
        await editDraft(
          db,
          organizationId(req),
          uuid(req.params.proposalId),
          uuid(req.params.versionId),
          req.user!,
          input,
          expectedRevision,
        ),
      )
    },
  )
  router.post(
    '/proposals/:proposalId/versions/:versionId/send',
    requireOwner(),
    async (req, res) => {
      const { expectedRevision } = sendVersionSchema.parse(req.body)
      res.json(
        await sendVersion(
          db,
          organizationId(req),
          uuid(req.params.proposalId),
          uuid(req.params.versionId),
          req.user!,
          expectedRevision,
        ),
      )
    },
  )
  router.post(
    '/proposals/:proposalId/versions/:versionId/decision',
    async (req, res) => {
      const { outcome } = decisionSchema.parse(req.body)
      res.json(
        await decideVersion(
          db,
          organizationId(req),
          uuid(req.params.proposalId),
          uuid(req.params.versionId),
          req.user!,
          outcome,
        ),
      )
    },
  )
  router.get('/projects', async (req, res) => {
    const orgId = organizationId(req)
    await scopedOrganization(db, orgId, req.user!)
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page ?? 1)
    const rows = await db.project.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * 20,
      take: 21,
      select: {
        id: true,
        proposalId: true,
        status: true,
        approvedVersion: { select: { title: true } },
      },
    })
    res.json({ projects: rows.slice(0, 20), page, hasMore: rows.length > 20 })
  })
  router.get('/projects/:projectId', async (req, res) => {
    res.json({
      project: await readProject(
        db,
        organizationId(req),
        uuid(req.params.projectId),
        req.user!,
      ),
    })
  })
  return router
}
