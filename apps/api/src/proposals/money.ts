import {
  MAX_TOTAL_MINOR,
  proposalDraftSchema,
  type ProposalDraft,
} from '@jcb/contracts'
import { HttpError } from '../errors.js'
export function calculateTotal(draft: ProposalDraft) {
  const parsed = proposalDraftSchema.parse(draft)
  const total = parsed.items.reduce(
    (sum, item) => sum + BigInt(item.quantity) * BigInt(item.unitPriceMinor),
    0n,
  )
  if (total > MAX_TOTAL_MINOR)
    throw new HttpError(
      400,
      'TOTAL_OUT_OF_BOUNDS',
      'Proposal total exceeds the supported minor-unit bound.',
    )
  return total
}
