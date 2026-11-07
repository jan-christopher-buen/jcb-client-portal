import express, { type ErrorRequestHandler } from 'express'
import helmet from 'helmet'
import session from 'express-session'
import { boundedJson } from './payloads.js'
import { sessionStore } from './auth/session-store.js'
import type { Pool } from 'pg'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Config } from './config.js'
import { createDatabase } from './database.js'
import type { PrismaClient } from './generated/prisma/client.js'
import { authentication } from './auth/routes.js'
import { csrfProtection } from './auth/security.js'
import { organizationRoutes } from './organizations/routes.js'
import { invitationRoutes } from './invitations/routes.js'
import { localMailer, type Mailer } from './invitations/mail.js'
import { HttpError } from './errors.js'
import { ZodError } from 'zod'
import { handoverRoutes } from './handover/routes.js'
import { deliverableRoutes } from './deliverables/routes.js'
import { changeRoutes } from './changes/routes.js'
import { projectRoutes } from './projects/routes.js'
import { proposalRoutes } from './proposals/routes.js'

export function createApp(
  config: Config,
  pool: Pool,
  dependencies: { db?: PrismaClient; mailer?: Mailer } = {},
) {
  const db = dependencies.db ?? createDatabase(config.DATABASE_URL)
  const auth = authentication(db, config)
  const app = express()
  app.disable('x-powered-by')
  // Trust only the immediate Render ingress, never every forwarded hop.
  // Further edge hops remain untrusted; req.ip may identify a shared proxy.
  app.set('trust proxy', config.TRUST_PROXY === 'render-edge' ? 1 : false)
  app.use(
    helmet({
      referrerPolicy: { policy: 'no-referrer' },
      contentSecurityPolicy: {
        directives: {
          upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null,
        },
      },
    }),
  )
  app.use(boundedJson)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  const { store, trackGeneration } = sessionStore(pool)
  const sessionMiddleware = session({
    name: 'jcb.sid',
    store,
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    },
  })
  trackGeneration()
  app.use(
    '/api',
    (_req, res, next) => {
      res.set('Cache-Control', 'no-store')
      next()
    },
    sessionMiddleware,
  )
  app.use(
    '/api',
    auth.expire,
    auth.passport.initialize(),
    auth.passport.session(),
    csrfProtection(config.APP_ORIGIN),
  )
  app.use('/api/auth', auth.router)
  app.use('/api/organizations', organizationRoutes(db))
  app.use('/api/organizations/:orgId', proposalRoutes(db))
  app.use('/api/organizations/:orgId', projectRoutes(db))
  app.use('/api/organizations/:orgId/projects/:projectId', handoverRoutes(db))
  app.use('/api/organizations/:orgId/projects/:projectId', changeRoutes(db))
  app.use(
    '/api/organizations/:orgId/projects/:projectId',
    deliverableRoutes(db),
  )
  app.use(
    '/api',
    invitationRoutes(db, config, dependencies.mailer ?? localMailer(config)),
  )
  app.use('/api', (_req, res) => {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } })
  })
  const webRoot = resolve(import.meta.dirname, '../../web/dist')
  if (
    config.NODE_ENV === 'production' &&
    !existsSync(resolve(webRoot, 'index.html'))
  )
    throw new Error('Web build is missing. Run npm run build first.')
  if (existsSync(resolve(webRoot, 'index.html'))) {
    app.use(express.static(webRoot))
    app.get(
      [
        '/',
        '/sign-in',
        '/invitation',
        '/organizations',
        '/organizations/:id',
        '/organizations/:orgId/proposals',
        '/organizations/:orgId/proposals/new',
        '/organizations/:orgId/proposals/:proposalId',
        '/organizations/:orgId/proposals/:proposalId/versions/:versionId/edit',
        '/organizations/:orgId/projects/:projectId',
        '/organizations/:orgId/projects/:projectId/milestones/:milestoneId',
        '/organizations/:orgId/projects/:projectId/handover',
        '/organizations/:orgId/projects/:projectId/deliverables/:deliverableId',
        '/organizations/:orgId/projects/:projectId/deliverables/:deliverableId/versions/:versionId/edit',
        '/organizations/:orgId/projects/:projectId/changes',
        '/organizations/:orgId/projects/:projectId/changes/:requestId',
        '/organizations/:orgId/projects/:projectId/changes/:requestId/offers/:offerId/edit',
      ],
      (_req, res) => {
        res.sendFile(resolve(webRoot, 'index.html'))
      },
    )
  }
  app.use((_req, res) => {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Page not found.' } })
  })
  const onError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof HttpError) {
      res
        .status(error.status)
        .json({ error: { code: error.code, message: error.message } })
      return
    }
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Check the required fields and try again.',
        },
      })
      return
    }
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'This record already exists. Refresh and try again.',
        },
      })
      return
    }
    const malformed =
      error instanceof SyntaxError && 'status' in error && error.status === 400
    const tooLarge =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      error.status === 413
    res.status(malformed ? 400 : tooLarge ? 413 : 500).json({
      error: {
        code: malformed
          ? 'INVALID_JSON'
          : tooLarge
            ? 'PAYLOAD_TOO_LARGE'
            : 'INTERNAL_ERROR',
        message: malformed
          ? 'Invalid JSON body.'
          : tooLarge
            ? 'Request body is too large.'
            : 'Something went wrong.',
      },
    })
  }
  app.use(onError)
  return { app, store, db }
}
