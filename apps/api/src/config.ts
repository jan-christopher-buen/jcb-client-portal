import { z } from 'zod'
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LISTEN_HOST: z.literal('127.0.0.1').optional(),
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
  return result.data
}
export type Config = ReturnType<typeof readConfig>
