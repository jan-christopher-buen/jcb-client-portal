import { describe, expect, it } from 'vitest'
import { proposalDraftSchema, formatPhp, MAX_TOTAL_MINOR } from '@jcb/contracts'
import { calculateTotal } from '../src/proposals/money.js'
const base = {
  title: 'Exact proposal',
  scope: 'A website',
  exclusions: '',
  deliveryAssumptions: '',
  internalNotes: '',
  currency: 'PHP' as const,
  items: [
    { description: 'Implementation', quantity: 3, unitPriceMinor: '101' },
    { description: 'Included handover', quantity: 1, unitPriceMinor: '0' },
  ],
}
describe('authoritative exact PHP money', () => {
  it('calculates exact centavos and preserves zero-price items', () => {
    expect(calculateTotal(base)).toBe(303n)
    expect(formatPhp('303')).toBe('PHP 3.03')
    expect(formatPhp('0')).toBe('PHP 0.00')
  })
  it('serializes values beyond Number.MAX_SAFE_INTEGER without loss', () => {
    const input = {
      ...base,
      items: [
        {
          description: 'Large bounded item',
          quantity: 10000,
          unitPriceMinor: '999999999999',
        },
      ],
    }
    expect(calculateTotal(input).toString()).toBe('9999999999990000')
    expect(
      JSON.stringify({ totalMinor: calculateTotal(input).toString() }),
    ).toBe('{"totalMinor":"9999999999990000"}')
    expect(formatPhp('9999999999990000')).toBe('PHP 99,999,999,999,900.00')
  })
  it('rejects invalid, fractional, negative, unbounded or numeric prices/quantities', () => {
    for (const quantity of [0, -1, 1.5, 10001, '1', Number.MAX_SAFE_INTEGER])
      expect(
        proposalDraftSchema.safeParse({
          ...base,
          items: [{ ...base.items[0], quantity }],
        }).success,
      ).toBe(false)
    for (const unitPriceMinor of [
      '-1',
      '1.5',
      '01',
      '1e2',
      '1000000000001',
      '',
      ' 1',
      100,
      '9'.repeat(1000),
    ])
      expect(
        proposalDraftSchema.safeParse({
          ...base,
          items: [{ ...base.items[0], unitPriceMinor }],
        }).success,
      ).toBe(false)
    expect(
      proposalDraftSchema.safeParse({ ...base, currency: 'USD' }).success,
    ).toBe(false)
    expect(
      proposalDraftSchema.safeParse({ ...base, totalMinor: '1' }).success,
    ).toBe(false)
  })
  it('enforces item count and aggregate bounds at the exact boundary', () => {
    const item = {
      description: 'Bounded',
      quantity: 10000,
      unitPriceMinor: '1000000000000',
    }
    expect(
      calculateTotal({
        ...base,
        items: Array.from({ length: 10 }, () => item),
      }),
    ).toBe(MAX_TOTAL_MINOR)
    expect(() =>
      calculateTotal({
        ...base,
        items: Array.from({ length: 11 }, () => item),
      }),
    ).toThrow('exceeds')
    for (const items of [[], Array.from({ length: 101 }, () => item)])
      expect(proposalDraftSchema.safeParse({ ...base, items }).success).toBe(
        false,
      )
  })
})
