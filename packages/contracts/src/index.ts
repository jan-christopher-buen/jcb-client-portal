import { z } from 'zod'
export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})
export const healthSchema = z.object({ status: z.literal('ok') })
export type ApiError = z.infer<typeof apiErrorSchema>
