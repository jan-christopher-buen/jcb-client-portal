import express, { type ErrorRequestHandler } from 'express'
import helmet from 'helmet'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import type { Pool } from 'pg'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Config } from './config.js'

export function createApp(config: Config, pool: Pool) {
  const app = express()
  app.disable('x-powered-by')
  // Direct connection only. Set an exact trusted proxy policy after host selection.
  app.set('trust proxy', false)
  app.use(helmet())
  app.use(express.json({ limit: '16kb' }))
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  const PgStore = connectPgSimple(session)
  const store = new PgStore({
    pool,
    createTableIfMissing: false,
    errorLog: () => console.error('Session storage operation failed'),
  })
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
  app.use(
    '/api',
    (_req, res, next) => {
      res.set('Cache-Control', 'no-store')
      next()
    },
    sessionMiddleware,
  )
  app.get('/api/auth/me', (_req, res) => {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Sign in is not available yet.',
      },
    })
  })
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
    app.get(['/', '/sign-in'], (_req, res) => {
      res.sendFile(resolve(webRoot, 'index.html'))
    })
  }
  app.use((_req, res) => {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Page not found.' } })
  })
  const onError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
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
  return { app, store }
}
