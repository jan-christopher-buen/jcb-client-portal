import { describe, expect, it } from 'vitest'
import { readConfig } from '../src/config.js'
import {
  localDatabase,
  testDatabase,
} from '../../../scripts/database-safety.js'
describe('environment and database safety', () => {
  it('does not leak invalid values', () => {
    expect(() => readConfig({ DATABASE_URL: 'sensitive-value' })).toThrow(
      'Invalid environment configuration',
    )
  })
  it('requires local dedicated test databases', () => {
    for (const value of [
      undefined,
      'postgresql://localhost/jcb_portal_dev',
      'postgresql://remote.example/jcb_portal_test',
      'postgresql://localhost/production',
    ]) {
      expect(() => testDatabase({ TEST_DATABASE_URL: value })).toThrow()
    }
    expect(
      testDatabase({
        TEST_DATABASE_URL: 'postgresql://localhost/jcb_portal_test',
        DATABASE_URL: 'postgresql://localhost/jcb_portal_dev',
      }),
    ).toBe('postgresql://localhost/jcb_portal_test')
    expect(() =>
      testDatabase({
        TEST_DATABASE_URL: 'postgresql://localhost/jcb_portal_test',
        DATABASE_URL: 'postgresql://127.0.0.1/jcb_portal_test',
      }),
    ).toThrow()
  })
  it('prevents local seed and migration against other databases', () => {
    expect(() =>
      localDatabase('postgresql://localhost/postgres', 'dev'),
    ).toThrow()
  })
})
