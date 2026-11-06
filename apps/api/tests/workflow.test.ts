import { describe, expect, it } from 'vitest'
import {
  dateOnlySchema,
  manilaDate,
  milestoneOverdue,
  milestoneProgress,
  milestoneActionSchema,
  projectTransitionSchema,
  reviewDecisionSchema,
} from '@jcb/contracts'
describe('date-only workflow rules', () => {
  it('validates real calendar dates and explicit bounds', () => {
    for (const date of ['2024-02-29', '1900-01-01', '9999-12-31'])
      expect(dateOnlySchema.safeParse(date).success).toBe(true)
    for (const date of [
      '2026-02-29',
      '2026-04-31',
      '0000-01-01',
      '2026-1-1',
      '2026-11-06T00:00:00Z',
      '10000-01-01',
    ])
      expect(dateOnlySchema.safeParse(date).success).toBe(false)
  })
  it('crosses midnight in Manila, not server timezone or UTC midnight', () => {
    expect(manilaDate(new Date('2026-11-06T15:59:59.999Z'))).toBe('2026-11-06')
    expect(manilaDate(new Date('2026-11-06T16:00:00.000Z'))).toBe('2026-11-07')
    expect(
      milestoneOverdue('2026-11-06', 'IN_REVIEW', 'ACTIVE', '2026-11-06'),
    ).toBe(false)
    expect(
      milestoneOverdue('2026-11-06', 'IN_REVIEW', 'ACTIVE', '2026-11-07'),
    ).toBe(true)
    expect(
      milestoneOverdue('2026-11-06', 'IN_PROGRESS', 'ON_HOLD', '2026-11-07'),
    ).toBe(true)
    for (const status of ['CANCELLED', 'COMPLETED'])
      expect(
        milestoneOverdue('2026-11-06', 'PLANNED', status, '2026-11-07'),
      ).toBe(false)
    expect(
      milestoneOverdue('2026-11-06', 'ACCEPTED', 'ACTIVE', '2026-11-07'),
    ).toBe(false)
    expect(milestoneOverdue(null, 'PLANNED', 'ACTIVE', '2026-11-07')).toBe(
      false,
    )
  })
  it('counts only required accepted milestones, including none and reopening', () => {
    expect(milestoneProgress([])).toEqual({ accepted: 0, total: 0 })
    expect(
      milestoneProgress([{ required: false, status: 'ACCEPTED' }]),
    ).toEqual({ accepted: 0, total: 0 })
    const rows = [
      { required: true, status: 'ACCEPTED' },
      { required: true, status: 'PLANNED' },
      { required: false, status: 'ACCEPTED' },
    ]
    expect(milestoneProgress(rows)).toEqual({ accepted: 1, total: 2 })
    rows[0]!.status = 'IN_PROGRESS'
    expect(milestoneProgress(rows)).toEqual({ accepted: 0, total: 2 })
  })
  it('requires reasons/feedback and excludes completion', () => {
    for (const action of ['HOLD', 'CANCEL'])
      expect(
        projectTransitionSchema.safeParse({
          action,
          expectedRevision: 0,
          reason: ' ',
        }).success,
      ).toBe(false)
    for (const action of ['WITHDRAW', 'REOPEN'])
      expect(
        milestoneActionSchema.safeParse({ action, expectedRevision: 0 })
          .success,
      ).toBe(false)
    expect(
      projectTransitionSchema.safeParse({
        action: 'COMPLETE',
        expectedRevision: 0,
      }).success,
    ).toBe(false)
    expect(
      reviewDecisionSchema.safeParse({
        outcome: 'CHANGES_REQUESTED',
        feedback: ' ',
      }).success,
    ).toBe(false)
  })
})
