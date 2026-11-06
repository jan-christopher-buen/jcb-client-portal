import { describe, it, expect } from 'vitest'
import {
  handoverItemSchema,
  handoverEditSchema,
  handoverCheckSchema,
  completionSchema,
  reopenProjectSchema,
} from './index.js'
describe('handover command boundaries', () => {
  it('requires explicit completion confirmation and rejects browser readiness/snapshot claims', () => {
    expect(
      completionSchema.safeParse({ confirm: true, expectedRevision: 0 })
        .success,
    ).toBe(true)
    for (const data of [
      { confirm: false, expectedRevision: 0 },
      { confirm: true, expectedRevision: -1 },
      { confirm: true, expectedRevision: 0, ready: true },
      { confirm: true, expectedRevision: 0, acceptedVersionIds: [] },
    ])
      expect(completionSchema.safeParse(data).success).toBe(false)
  })
  it('bounds checklist metadata and requires reasons for edits, checks and reopen', () => {
    const item = {
      title: 'Share documentation',
      description: 'Record the handover without credentials.',
      required: true,
      clientVisible: true,
      position: 1,
    }
    expect(handoverItemSchema.safeParse(item).success).toBe(true)
    for (const fields of [
      { title: '' },
      { description: '' },
      { position: 0 },
      { position: 101 },
      { completedBy: 'browser actor' },
    ])
      expect(handoverItemSchema.safeParse({ ...item, ...fields }).success).toBe(
        false,
      )
    expect(
      handoverEditSchema.safeParse({
        ...item,
        expectedRevision: 0,
        reason: ' ',
      }).success,
    ).toBe(false)
    expect(
      handoverCheckSchema.safeParse({
        completed: true,
        expectedRevision: 0,
        reason: ' ',
      }).success,
    ).toBe(false)
    expect(
      reopenProjectSchema.safeParse({ expectedRevision: 0, reason: ' ' })
        .success,
    ).toBe(false)
  })
})
