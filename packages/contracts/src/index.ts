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
  status: ProjectStatus
  createdAt: string
  approvedVersion: ProposalVersionDto
}
export function formatPhp(minor: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(minor))
    throw new Error('Invalid minor-unit value')
  const amount = BigInt(minor)
  return `PHP ${new Intl.NumberFormat('en-PH').format(amount / 100n)}.${String(amount % 100n).padStart(2, '0')}`
}

export const projectStatuses = [
  'PLANNED',
  'ACTIVE',
  'IN_REVIEW',
  'ON_HOLD',
  'CANCELLED',
  'COMPLETED',
] as const
export type ProjectStatus = (typeof projectStatuses)[number]
export const revisionSchema = z.number().int().min(0).max(2147483646)
export const reasonSchema = z.string().trim().min(1).max(2000)
export const projectTransitionSchema = z
  .object({
    action: z.enum(['ACTIVATE', 'REVIEW', 'HOLD', 'RESUME', 'CANCEL']),
    expectedRevision: revisionSchema,
    reason: z.string().trim().max(2000).default(''),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.action === 'HOLD' || v.action === 'CANCEL') && !v.reason)
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'A reason is required.',
      })
  })
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return (
      value >= '1900-01-01' &&
      value <= '9999-12-31' &&
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    )
  }, 'Use a valid date from 1900 through 9999.')
export const milestoneInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(12000),
    dueDate: dateOnlySchema.nullable(),
    required: z.boolean(),
    position: z.number().int().min(1).max(100),
  })
  .strict()
export const milestoneEditSchema = milestoneInputSchema.extend({
  requiredChangeReason: z.string().trim().max(2000).default(''),
  expectedRevision: revisionSchema,
})
export const milestoneActionSchema = z
  .object({
    action: z.enum(['START', 'SUBMIT', 'WITHDRAW', 'REOPEN']),
    expectedRevision: revisionSchema,
    reason: z.string().trim().max(2000).default(''),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.action === 'WITHDRAW' || v.action === 'REOPEN') && !v.reason)
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'A reason is required.',
      })
  })
export const reviewDecisionSchema = z
  .object({
    outcome: z.enum(['ACCEPTED', 'CHANGES_REQUESTED']),
    feedback: z.string().trim().max(4000).default(''),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.outcome === 'CHANGES_REQUESTED' && !v.feedback)
      ctx.addIssue({
        code: 'custom',
        path: ['feedback'],
        message: 'Feedback is required.',
      })
  })
export type MilestoneInput = z.infer<typeof milestoneInputSchema>
export type ReviewDto = {
  id: string
  number: number
  title: string
  description: string
  status: 'PENDING' | 'ACCEPTED' | 'CHANGES_REQUESTED' | 'WITHDRAWN'
  submittedAt: string
  submitter: { id: string; name: string }
  decisionActor: { id: string; name: string } | null
  decidedAt: string | null
  feedback: string | null
  withdrawer: { id: string; name: string } | null
  withdrawnAt: string | null
  withdrawalReason: string | null
}
export type MilestoneDto = MilestoneInput & {
  id: string
  projectId: string
  organizationId: string
  status: 'PLANNED' | 'IN_PROGRESS' | 'IN_REVIEW' | 'ACCEPTED'
  revision: number
  currentReviewId: string | null
  overdue: boolean
  reviews: ReviewDto[]
}
export type WorkflowEventDto = {
  id: string
  milestoneId: string | null
  kind: string
  fromState: string | null
  toState: string
  reason: string
  createdAt: string
  actor: { id: string; name: string }
}
export type WorkflowDto = {
  project: {
    id: string
    status: ProjectStatus
    resumeStatus: ProjectStatus | null
    revision: number
  }
  milestones: MilestoneDto[]
  events: WorkflowEventDto[]
  hasMoreEvents: boolean
  progress: { accepted: number; total: number }
  today: string
}
export function manilaDate(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
export function milestoneOverdue(
  dueDate: string | null,
  status: string,
  projectStatus: string,
  today: string,
) {
  return (
    !!dueDate &&
    dueDate < today &&
    status !== 'ACCEPTED' &&
    projectStatus !== 'CANCELLED' &&
    projectStatus !== 'COMPLETED'
  )
}
export function milestoneProgress(
  rows: { required: boolean; status: string }[],
) {
  const required = rows.filter((row) => row.required)
  return {
    accepted: required.filter((row) => row.status === 'ACCEPTED').length,
    total: required.length,
  }
}

export const signedAdjustmentSchema = z
  .string()
  .regex(/^(0|-?[1-9][0-9]{0,17})$/)
  .refine(
    (v) =>
      /^(0|-?[1-9][0-9]{0,17})$/.test(v) &&
      BigInt(v) >= -MAX_TOTAL_MINOR &&
      BigInt(v) <= MAX_TOTAL_MINOR,
  )
export const changeRequestSchema = z
  .object({
    title: nameSchema,
    requestedChange: z.string().trim().min(1).max(8000),
    businessContext: z.string().trim().min(1).max(4000),
  })
  .strict()
export const changeMessageSchema = z
  .object({
    kind: z.enum(['CLARIFICATION', 'RESPONSE', 'OWNER_NOTE']),
    body: z.string().trim().min(1).max(4000),
    expectedRevision: revisionSchema,
  })
  .strict()
export const changeOfferSchema = z
  .object({
    scope: z.string().trim().min(1).max(8000),
    exclusions: z.string().trim().max(4000),
    adjustmentMinor: signedAdjustmentSchema,
    scheduleImpact: z.string().trim().min(1).max(2000),
  })
  .strict()
export const changeOfferEditSchema = changeOfferSchema.extend({
  expectedRevision: revisionSchema,
})
export const changeImplementSchema = z
  .object({ expectedRevision: revisionSchema, note: reasonSchema })
  .strict()
export type ChangeRequestInput = z.infer<typeof changeRequestSchema>
export type ChangeOfferInput = z.infer<typeof changeOfferSchema>
export type AgreedAmounts = {
  originalMinor: string
  adjustmentsMinor: string
  revisedMinor: string
  approvedChanges: {
    requestId: string
    offerId: string
    title: string
    number: number
    adjustmentMinor: string
  }[]
}
export type ChangeOfferDto = ChangeOfferInput & {
  id: string
  number: number
  revision: number
  state:
    'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'APPROVED' | 'DECLINED' | 'ABANDONED'
  publishedAt: string | null
  decision: DecisionReceipt | null
}
export type ChangeRequestDto = ChangeRequestInput & {
  id: string
  projectId: string
  organizationId: string
  revision: number
  state:
    | 'OPEN'
    | 'NEEDS_CLARIFICATION'
    | 'OFFERED'
    | 'APPROVED'
    | 'DECLINED'
    | 'IMPLEMENTED'
    | 'CLOSED'
  creator: { id: string; name: string }
  createdAt: string
  publishedOfferId: string | null
  implementationNote: string | null
  implementedAt: string | null
  implementer: { id: string; name: string } | null
  messages: {
    id: string
    kind: 'CLARIFICATION' | 'RESPONSE' | 'OWNER_NOTE'
    body: string
    createdAt: string
    actor: { id: string; name: string }
  }[]
  offers: ChangeOfferDto[]
}
export type ChangeProject = {
  id: string
  status: ProjectStatus
  revision: number
}
export type ChangeDetailDto = {
  request: ChangeRequestDto
  amounts: AgreedAmounts
  project: ChangeProject
}
export type ChangeListDto = {
  requests: Pick<
    ChangeRequestDto,
    'id' | 'title' | 'state' | 'createdAt' | 'publishedOfferId'
  >[]
  amounts: AgreedAmounts
  project: ChangeProject
  page: number
  hasMore: boolean
}
export function revisedAgreement(original: bigint, adjustments: bigint[]) {
  if (
    original < 0n ||
    original > MAX_TOTAL_MINOR ||
    adjustments.some((v) => v < -MAX_TOTAL_MINOR || v > MAX_TOTAL_MINOR)
  )
    throw new Error('Amount outside supported bounds')
  const adjustment = adjustments.reduce((sum, value) => sum + value, 0n)
  const revised = original + adjustment
  if (revised < 0n || revised > MAX_TOTAL_MINOR)
    throw new Error(
      'Revised agreed amount must be between zero and the supported maximum',
    )
  return {
    originalMinor: original.toString(),
    adjustmentsMinor: adjustment.toString(),
    revisedMinor: revised.toString(),
  }
}
export function formatSignedPhp(value: string) {
  if (!/^(0|-?[1-9][0-9]*)$/.test(value))
    throw new Error('Invalid signed minor-unit value')
  return `${value.startsWith('-') ? '−' : ''}${formatPhp(value.replace('-', ''))}`
}
export function phpAdjustmentToMinor(value: string) {
  if (!/^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/.test(value))
    throw new Error(
      'Enter a signed PHP amount with up to two decimal places, without commas.',
    )
  const negative = value.startsWith('-'),
    [whole, fraction = ''] = value.replace('-', '').split('.')
  const minor = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))
  return signedAdjustmentSchema.parse((negative ? -minor : minor).toString())
}

// Deliberately accepts DNS destinations only. No resolution or fetching occurs.
export function externalHttpsUrl(value: string): string | null {
  if (
    value.length > 1000 ||
    !/^https:\/\//i.test(value) ||
    /[\s\\]/u.test(value) ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    /%(?![a-f0-9]{2})/i.test(value)
  )
    return null
  const authority = value.match(/^https:\/\/([^/?#]*)/i)?.[1]
  if (!authority || authority.includes('@')) return null
  try {
    const url = new URL(value),
      host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !host.includes('.') ||
      host.includes(':') ||
      host.startsWith('[') ||
      /^[0-9.]+$/.test(host)
    )
      return null
    if (
      ['localhost', 'local', 'internal', 'lan', 'home', 'localdomain'].some(
        (suffix) => host === suffix || host.endsWith('.' + suffix),
      )
    )
      return null
    if (
      host.length > 253 ||
      host
        .split('.')
        .some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
    )
      return null
    return url.href
  } catch {
    return null
  }
}
export const deliverableLinkSchema = z
  .object({
    label: nameSchema,
    url: z
      .string()
      .max(1000)
      .refine(
        (v) => externalHttpsUrl(v) !== null,
        'Use an HTTPS DNS URL without credentials or local/IP destinations.',
      )
      .transform((v) => externalHttpsUrl(v)!),
  })
  .strict()
export const deliverableContentSchema = z
  .object({
    title: nameSchema,
    description: z.string().trim().min(1).max(8000),
    links: z.array(deliverableLinkSchema).max(5),
  })
  .strict()
export const deliverableMetadataSchema = z
  .object({ required: z.boolean(), position: z.number().int().min(1).max(100) })
  .strict()
export const deliverableCreateSchema = deliverableContentSchema.extend(
  deliverableMetadataSchema.shape,
)
export const deliverableEditSchema = deliverableContentSchema.extend({
  expectedRevision: revisionSchema,
})
export const deliverableMetadataEditSchema = deliverableMetadataSchema.extend({
  requiredChangeReason: z.string().trim().max(2000).default(''),
  expectedRevision: revisionSchema,
})
export const deliverablePublishSchema = z
  .object({
    expectedRevision: revisionSchema,
    expectedDeliverableRevision: revisionSchema,
    reason: z.string().trim().max(2000).default(''),
  })
  .strict()
export const deliverableWithdrawSchema = z
  .object({ expectedRevision: revisionSchema, reason: reasonSchema })
  .strict()
export const deliverableDecisionSchema = reviewDecisionSchema
export type DeliverableContent = z.infer<typeof deliverableContentSchema>
export type DeliverableVersionDto = DeliverableContent & {
  id: string
  number: number
  revision: number
  state: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'WITHDRAWN'
  publishedAt: string | null
  publicationReason: string
  decision: {
    id: string
    versionId: string
    actor: { id: string; name: string }
    outcome: 'ACCEPTED' | 'CHANGES_REQUESTED'
    feedback: string
    createdAt: string
  } | null
}
export type DeliverableDto = {
  id: string
  projectId: string
  organizationId: string
  required: boolean
  position: number
  revision: number
  currentVersionId: string | null
  acceptance:
    | 'UNPUBLISHED'
    | 'PENDING_REVIEW'
    | 'ACCEPTED'
    | 'CHANGES_REQUESTED'
    | 'WITHDRAWN'
  versions: DeliverableVersionDto[]
  events: {
    id: string
    kind: string
    versionNumber: number | null
    reason: string
    requiredBefore: boolean | null
    requiredAfter: boolean | null
    actor: { id: string; name: string }
    createdAt: string
  }[]
}
export type DeliverableListDto = {
  deliverables: Omit<DeliverableDto, 'events'>[]
  project: ChangeProject
}
export type DeliverableDetailDto = {
  deliverable: DeliverableDto
  project: ChangeProject
  page: number
  hasMoreEvents: boolean
}

export const handoverItemSchema = z
  .object({
    title: nameSchema,
    description: z.string().trim().min(1).max(4000),
    required: z.boolean(),
    clientVisible: z.boolean(),
    position: z.number().int().min(1).max(100),
  })
  .strict()
export const handoverEditSchema = handoverItemSchema.extend({
  expectedRevision: revisionSchema,
  reason: reasonSchema,
})
export const handoverCheckSchema = z
  .object({
    completed: z.boolean(),
    expectedRevision: revisionSchema,
    reason: reasonSchema,
  })
  .strict()
export const completionSchema = z
  .object({ confirm: z.literal(true), expectedRevision: revisionSchema })
  .strict()
export const reopenProjectSchema = z
  .object({ reason: reasonSchema, expectedRevision: revisionSchema })
  .strict()
export const closeChangeSchema = reopenProjectSchema
export type HandoverItemInput = z.infer<typeof handoverItemSchema>
export type HandoverItemDto = HandoverItemInput & {
  id: string
  revision: number
  completedAt: string | null
  completer: { id: string; name: string } | null
}
export type CompletionBlocker = { code: string; message: string; path: string }
export type CompletionSnapshot = {
  milestones: {
    id: string
    title: string
    required: boolean
    status: string
    reviewId: string | null
    round: number | null
  }[]
  deliverables: {
    id: string
    title: string
    required: boolean
    versionId: string | null
    number: number | null
    decisionId: string | null
    outcome: string | null
  }[]
  changes: {
    id: string
    title: string
    state: string
    offerId: string | null
    implementationNote: string | null
    implementedAt: string | null
  }[]
  checklist: HandoverItemDto[]
}
export type CompletionReadinessDto = {
  project: { id: string; status: ProjectStatus; revision: number }
  ready: boolean
  blockers: CompletionBlocker[]
}
export type HandoverDto = CompletionReadinessDto & {
  items: HandoverItemDto[]
  completions: {
    id: string
    cycle: number
    actor: { id: string; name: string }
    completedAt: string
    snapshot: CompletionSnapshot
  }[]
  events: {
    id: string
    kind: string
    targetId: string
    reason: string
    details: Record<string, unknown>
    actor: { id: string; name: string }
    createdAt: string
  }[]
  page: number
  hasMoreEvents: boolean
}
