import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import type { PrismaClient } from '../generated/prisma/client.js'
import { HttpError } from '../errors.js'
export const SESSION_AGE = 8 * 60 * 60 * 1000
export function issueCsrf() {
  return randomBytes(32).toString('hex')
}
export const csrfProtection =
  (origin: string): RequestHandler =>
  (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
    const token = req.get('X-CSRF-Token')
    if (
      req.get('Origin') !== origin ||
      !token ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !req.session.csrf ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrf))
    )
      return next(
        new HttpError(403, 'CSRF_INVALID', 'Refresh the page and try again.'),
      )
    next()
  }
export function requireUser(): RequestHandler {
  return (req, _res, next) =>
    req.user
      ? next()
      : next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in.'))
}
export function requireOwner(): RequestHandler {
  return (req, _res, next) =>
    !req.user
      ? next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in.'))
      : req.user.role !== 'OWNER'
        ? next(new HttpError(403, 'FORBIDDEN', 'Owner access required.'))
        : next()
}
export function throttle(
  db: PrismaClient,
  secret: string,
  scope: string,
  limit: number,
): RequestHandler {
  return async (req, res, next) => {
    const key = createHmac('sha256', secret)
      .update(`${scope}:${req.ip ?? 'unknown'}`)
      .digest('hex')
    const rows = await db.$queryRaw<{ count: number; reset_at: Date }[]>`
   INSERT INTO auth_throttles (key, count, reset_at) VALUES (${key}, 1, now() + interval '15 minutes')
   ON CONFLICT (key) DO UPDATE SET count = CASE WHEN auth_throttles.reset_at <= now() THEN 1 ELSE auth_throttles.count + 1 END,
   reset_at = CASE WHEN auth_throttles.reset_at <= now() THEN now() + interval '15 minutes' ELSE auth_throttles.reset_at END
   RETURNING count, reset_at`
    if (rows[0]!.count > limit) {
      res.set(
        'Retry-After',
        String(
          Math.max(
            1,
            Math.ceil((rows[0]!.reset_at.getTime() - Date.now()) / 1000),
          ),
        ),
      )
      return next(
        new HttpError(
          429,
          'RATE_LIMITED',
          'Too many attempts. Try again later.',
        ),
      )
    }
    next()
  }
}
