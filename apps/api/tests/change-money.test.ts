import { describe, expect, it } from 'vitest'
import {
  MAX_TOTAL_MINOR,
  signedAdjustmentSchema,
  revisedAgreement,
  phpAdjustmentToMinor,
  formatSignedPhp,
} from '@jcb/contracts'
describe('precise signed agreed-scope adjustments', () => {
  it('accepts positive, zero and negative bounded integer strings', () => {
    for (const value of [
      '0',
      '1',
      '-1',
      MAX_TOTAL_MINOR.toString(),
      (-MAX_TOTAL_MINOR).toString(),
    ])
      expect(signedAdjustmentSchema.safeParse(value).success).toBe(true)
    for (const value of [
      '-0',
      '+1',
      '01',
      '-01',
      '1.1',
      '1e3',
      '',
      1,
      1.2,
      (MAX_TOTAL_MINOR + 1n).toString(),
      (-MAX_TOTAL_MINOR - 1n).toString(),
    ])
      expect(signedAdjustmentSchema.safeParse(value).success).toBe(false)
  })
  it('calculates signed totals beyond Number precision and serializes safely', () => {
    const result = revisedAgreement(9999999999990000n, [-1n, 2501n, 0n])
    expect(result).toEqual({
      originalMinor: '9999999999990000',
      adjustmentsMinor: '2500',
      revisedMinor: '9999999999992500',
    })
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(revisedAgreement(3500000n, [-3500000n])).toEqual({
      originalMinor: '3500000',
      adjustmentsMinor: '-3500000',
      revisedMinor: '0',
    })
  })
  it('rejects aggregate underflow/overflow and individually invalid bounds', () => {
    expect(() => revisedAgreement(0n, [-1n])).toThrow()
    expect(() => revisedAgreement(MAX_TOTAL_MINOR, [1n])).toThrow()
    expect(() => revisedAgreement(0n, [MAX_TOTAL_MINOR + 1n])).toThrow()
    expect(() => revisedAgreement(-1n, [])).toThrow()
    expect(
      revisedAgreement(MAX_TOTAL_MINOR, [-MAX_TOTAL_MINOR, MAX_TOTAL_MINOR])
        .revisedMinor,
    ).toBe(MAX_TOTAL_MINOR.toString())
  })
  it('converts and formats decimal PHP text without floats', () => {
    expect(phpAdjustmentToMinor('-2500.01')).toBe('-250001')
    expect(phpAdjustmentToMinor('-0.00')).toBe('0')
    expect(phpAdjustmentToMinor('999999999999999.99')).toBe('99999999999999999')
    expect(formatSignedPhp('-250001')).toBe('−PHP 2,500.01')
    for (const value of [
      '1.001',
      '1e4',
      '1,000.00',
      'NaN',
      '1000000000000000.01',
    ])
      expect(() => phpAdjustmentToMinor(value)).toThrow()
  })
})
