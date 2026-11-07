import express, { type RequestHandler } from 'express'

// Zod/HTML lengths count UTF-16 code units. JSON can use six bytes per
// unit (\\uXXXX), even when the original UTF-8 representation is smaller.
// Proposal: 90,120 text units plus bounded item keys/numbers < 560 KiB.
// Other organization commands: <= 14,120 text units + keys < 100 KiB.
// Auth/invitation commands: < 4 KiB even with every unit escaped.
export const JSON_LIMITS = {
  small: 16 * 1024,
  organization: 128 * 1024,
  proposal: 640 * 1024,
} as const
const parsers = {
  small: express.json({ limit: JSON_LIMITS.small }),
  organization: express.json({ limit: JSON_LIMITS.organization }),
  proposal: express.json({ limit: JSON_LIMITS.proposal }),
}
export const boundedJson: RequestHandler = (req, res, next) => {
  const proposal = /^\/api\/organizations\/[^/]+\/proposals(?:\/|$)/i.test(
    req.path,
  )
  const organization = /^\/api\/organizations(?:\/|$)/i.test(req.path)
  return parsers[
    proposal ? 'proposal' : organization ? 'organization' : 'small'
  ](req, res, next)
}
