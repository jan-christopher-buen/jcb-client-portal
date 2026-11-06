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

export const MAX_QUANTITY = 10000
export const MAX_UNIT_PRICE_MINOR = 1000000000000n
export const MAX_TOTAL_MINOR = 100000000000000000n
export const minorPriceSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,12})$/)
  .refine(
    (v) =>
      /^(0|[1-9][0-9]{0,12})$/.test(v) && BigInt(v) <= MAX_UNIT_PRICE_MINOR,
  )
export const proposalItemSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    quantity: z.number().int().min(1).max(MAX_QUANTITY),
    unitPriceMinor: minorPriceSchema,
  })
  .strict()
export const proposalDraftSchema = z
  .object({
    title: nameSchema,
    scope: z.string().trim().min(1).max(12000),
    exclusions: z.string().max(12000),
    deliveryAssumptions: z.string().max(12000),
    internalNotes: z.string().max(4000).default(''),
    currency: z.literal('PHP'),
    items: z.array(proposalItemSchema).min(1).max(100),
  })
  .strict()
export const draftUpdateSchema = proposalDraftSchema
  .extend({ expectedRevision: z.number().int().min(0).max(2147483646) })
  .strict()
export const sendVersionSchema = z
  .object({ expectedRevision: z.number().int().min(0).max(2147483646) })
  .strict()
export const decisionSchema = z
  .object({ outcome: z.enum(['APPROVED', 'DECLINED']) })
  .strict()
export type ProposalDraft = z.infer<typeof proposalDraftSchema>
export type ProposalItem = z.infer<typeof proposalItemSchema>
export type DecisionReceipt = {
  id: string
  versionId: string
  actor: { id: string; name: string }
  outcome: 'APPROVED' | 'DECLINED'
  createdAt: string
}
export type ProposalVersionDto = Omit<ProposalDraft, 'internalNotes'> & {
  internalNotes?: string
  id: string
  number: number
  state: 'DRAFT' | 'SENT' | 'SUPERSEDED' | 'APPROVED' | 'DECLINED'
  editRevision: number
  totalMinor: string
  sentAt: string | null
  decision: DecisionReceipt | null
}
export type ProposalDto = {
  id: string
  organizationId: string
  publishedVersionId: string | null
  approved: boolean
  projectId: string | null
  versions: ProposalVersionDto[]
}
export type ProjectDto = {
  id: string
  organizationId: string
  proposalId: string
  status: 'PLANNED'
  createdAt: string
  approvedVersion: ProposalVersionDto
}
export function formatPhp(minor: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(minor))
    throw new Error('Invalid minor-unit value')
  const amount = BigInt(minor)
  return `PHP ${new Intl.NumberFormat('en-PH').format(amount / 100n)}.${String(amount % 100n).padStart(2, '0')}`
}
