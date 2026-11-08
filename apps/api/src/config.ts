import { z } from 'zod'
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LISTEN_HOST: z.literal('127.0.0.1').optional(),
  TRUST_PROXY: z.enum(['off', 'render-edge']).default('off'),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z
    .string()
    .url()
    .refine((v) => {
      try {
        return ['postgresql:', 'postgres:'].includes(new URL(v).protocol)
      } catch {
        return false
      }
    }),
  INVITATION_MAIL_MODE: z.enum(['disabled', 'local', 'resend']).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  INVITATION_FROM: z.string().email().optional(),
  STAGING_INVITATION_RECIPIENTS: z.string().optional(),
  SMTP_HOST: z.enum(['127.0.0.1', 'localhost', '::1']).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SESSION_SECRET: z.string().min(32),
})
export function readConfig(env: NodeJS.ProcessEnv) {
  const result = schema.safeParse(env)
  if (!result.success)
    throw new Error(
      'Invalid environment configuration. Check required variable names and formats.',
    )
  const origin = new URL(result.data.APP_ORIGIN)
  if (
    origin.origin !== result.data.APP_ORIGIN ||
    (result.data.NODE_ENV === 'production' && origin.protocol !== 'https:')
  )
    throw new Error(
      'APP_ORIGIN must be an exact origin; production requires HTTPS.',
    )
  if (
    result.data.TRUST_PROXY === 'render-edge' &&
    (env.RENDER !== 'true' || result.data.NODE_ENV !== 'production')
  )
    throw new Error(
      'Render proxy trust requires the production Render environment.',
    )
  if (result.data.NODE_ENV === 'production') {
    const db = new URL(result.data.DATABASE_URL)
    if (
      db.searchParams.get('sslmode') !== 'verify-full' ||
      [...db.searchParams.keys()].some(
        (key) => !['sslmode', 'application_name'].includes(key),
      ) ||
      db.searchParams.getAll('sslmode').length !== 1
    )
      throw new Error(
        'Production database requires verified TLS without connection overrides.',
      )
  }
  const mode =
    result.data.INVITATION_MAIL_MODE ??
    (result.data.NODE_ENV === 'production' ? 'disabled' : 'local')
  const recipients = (result.data.STAGING_INVITATION_RECIPIENTS ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
  if (
    (mode === 'local' && result.data.NODE_ENV === 'production') ||
    (mode === 'resend' &&
      (origin.protocol !== 'https:' ||
        !result.data.RESEND_API_KEY ||
        !result.data.INVITATION_FROM ||
        !recipients.length ||
        recipients.some((v) => !z.string().email().safeParse(v).success)))
  )
    throw new Error('Invalid invitation mail configuration.')
  return {
    ...result.data,
    INVITATION_MAIL_MODE: mode,
    invitationRecipients: recipients,
  }
}
export type Config = ReturnType<typeof readConfig>
