import { z } from 'zod'
export const emailSchema = z.string().trim().toLowerCase().email().max(254)
export const passwordSchema = z.string().min(12).max(128)
export const nameSchema = z.string().trim().min(1).max(120)
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict()
export const organizationSchema = z
  .object({ name: nameSchema, notes: z.string().max(4000).default('') })
  .strict()
export const organizationUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    notes: z.string().max(4000).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
export const contactSchema = z
  .object({ name: nameSchema, email: emailSchema })
  .strict()
export const contactUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
export const inviteSchema = z.object({ email: emailSchema }).strict()
export const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const inspectInvitationSchema = z.object({ token: tokenSchema }).strict()
export const acceptInvitationSchema = z
  .object({
    token: tokenSchema,
    name: nameSchema.optional(),
    password: passwordSchema.optional(),
  })
  .strict()
export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})
export const healthSchema = z.object({ status: z.literal('ok') })
export const identitySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(['OWNER', 'CLIENT']),
})
export type Identity = z.infer<typeof identitySchema>
export type ApiError = z.infer<typeof apiErrorSchema>
export type OrganizationSummary = {
  id: string
  name: string
  createdAt: string
  archivedAt: string | null
}
export type OrganizationDetail = {
  organization: OrganizationSummary & { notes?: string }
  contacts?: {
    id: string
    name: string
    email: string
    archivedAt: string | null
  }[]
  memberships?: { id: string; revokedAt: string | null; user: Identity }[]
  invitations?: {
    id: string
    email: string
    expiresAt: string
    acceptedAt: string | null
    revokedAt: string | null
    deliveredAt: string | null
    deliveryFailed: boolean
  }[]
  activities?: {
    id: string
    kind: string
    createdAt: string
    actor: { name: string }
  }[]
}
export type InvitationPreview = {
  email: string
  organization: string
  accountExists: boolean
}
