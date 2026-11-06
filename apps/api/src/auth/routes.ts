import { Passport } from 'passport'
import { Strategy } from 'passport-local'
import { Router, type Request, type Response } from 'express'
import { loginSchema } from '@jcb/contracts'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { Config } from '../config.js'
import { verifyPassword } from './password.js'
import { HttpError } from '../errors.js'
import { issueCsrf, requireUser, SESSION_AGE, throttle } from './security.js'
import './types.js'
export const identitySelect = {
  id: true,
  email: true,
  name: true,
  role: true,
} as const
export function establishSession(req: Request, user: Express.User) {
  // Passport 0.6+ regenerates the session during logIn, without retaining old data.
  return new Promise<void>((resolve, reject) =>
    req.logIn(user, (error) => {
      if (error) return reject(error)
      req.session.authenticatedAt = Date.now()
      req.session.csrf = issueCsrf()
      req.session.save((error) => (error ? reject(error) : resolve()))
    }),
  )
}
export function clearCookie(res: Response, config: Config) {
  res.clearCookie('jcb.sid', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
  })
}
export function authentication(db: PrismaClient, config: Config) {
  const passport = new Passport()
  passport.use(
    new Strategy({ usernameField: 'email' }, (email, password, done) => {
      void (async () => {
        const user = await db.user.findUnique({
          where: { email: email.trim().toLowerCase() },
        })
        const valid = await verifyPassword(password, user?.passwordHash)
        if (!user || user.disabledAt || !valid) return done(null, false)
        done(null, {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        })
      })().catch(() =>
        done(
          new HttpError(
            503,
            'AUTH_UNAVAILABLE',
            'Sign in is temporarily unavailable.',
          ),
        ),
      )
    }),
  )
  passport.serializeUser((user, done) => done(null, user.id))
  passport.deserializeUser<string>((id, done) => {
    void db.user
      .findFirst({ where: { id, disabledAt: null }, select: identitySelect })
      .then((user) => done(null, user ?? false))
      .catch(() =>
        done(
          new HttpError(
            503,
            'AUTH_UNAVAILABLE',
            'Session verification is temporarily unavailable.',
          ),
        ),
      )
  })
  const router = Router()
  router.get('/csrf', (req, res, next) => {
    req.session.csrf ??= issueCsrf()
    req.session.save((error) =>
      error ? next(error) : res.json({ token: req.session.csrf }),
    )
  })
  router.get('/me', requireUser(), (req, res) => res.json({ user: req.user }))
  router.post(
    '/login',
    throttle(db, config.SESSION_SECRET, 'login', 10),
    async (req, res, next) => {
      const parsed = loginSchema.safeParse(req.body)
      if (!parsed.success)
        throw new HttpError(
          401,
          'INVALID_CREDENTIALS',
          'Email or password is incorrect.',
        )
      req.body = parsed.data
      passport.authenticate(
        'local',
        (error: unknown, user: Express.User | false) => {
          if (error) return next(error)
          if (!user)
            return next(
              new HttpError(
                401,
                'INVALID_CREDENTIALS',
                'Email or password is incorrect.',
              ),
            )
          void establishSession(req, user)
            .then(() => res.json({ user }))
            .catch(next)
        },
      )(req, res, next)
    },
  )
  router.post('/logout', (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error)
      clearCookie(res, config)
      res.status(204).end()
    })
  })
  const expire = Router()
  expire.use((req, res, next) => {
    if (
      req.session.authenticatedAt &&
      Date.now() - req.session.authenticatedAt >= SESSION_AGE
    ) {
      return req.session.destroy((error) => {
        clearCookie(res, config)
        if (error) next(error)
        else
          next(
            new HttpError(
              401,
              'SESSION_EXPIRED',
              'Your session expired. Please sign in again.',
            ),
          )
      })
    }
    next()
  })
  return { passport, router, expire }
}
