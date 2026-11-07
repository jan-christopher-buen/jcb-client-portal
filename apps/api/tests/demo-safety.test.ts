import { describe, it, expect, vi } from 'vitest'
import type { PoolClient } from 'pg'
import { mkdtemp, rm, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  demoDatabase,
  localDatabase,
  testDatabase,
} from '../../../scripts/database-safety.js'
import {
  assertEmptyDemo,
  confirmEmptyDemo,
  credentialsPath,
} from '../../../scripts/demo-safety.js'
import { readConfig } from '../src/config.js'
const demo = {
  NODE_ENV: 'development',
  JCB_LOCAL_DEMO: '1',
  DEMO_DATABASE_URL: 'postgresql://localhost/jcb_portal_demo',
}
describe('opt-in local demonstration boundaries', () => {
  it('requires explicit development/demo mode and exact dedicated loopback database without connection overrides', () => {
    expect(demoDatabase(demo)).toBe(demo.DEMO_DATABASE_URL)
    for (const values of [
      { NODE_ENV: undefined },
      { NODE_ENV: 'production' },
      { NODE_ENV: 'test' },
      { JCB_LOCAL_DEMO: undefined },
      { JCB_LOCAL_DEMO: '0' },
      { DEMO_DATABASE_URL: undefined },
      ...[
        'postgresql://localhost/jcb_portal_dev',
        'postgresql://localhost/jcb_portal_test',
        'postgresql://localhost/production',
        'postgresql://remote.example/jcb_portal_demo',
        'postgresql://localhost/jcb_portal_demo?host=remote.example',
        'postgresql://localhost/jcb_portal_demo?database=production',
        'postgresql://localhost/jcb_portal_demo#override',
        'sensitive-invalid-url',
      ].map((DEMO_DATABASE_URL) => ({ DEMO_DATABASE_URL })),
    ]) {
      expect(() => demoDatabase({ ...demo, ...values })).toThrow()
    }
    expect(() => localDatabase(demo.DEMO_DATABASE_URL, 'dev')).toThrow()
    expect(() =>
      testDatabase({ TEST_DATABASE_URL: demo.DEMO_DATABASE_URL }),
    ).toThrow()
    expect(() => confirmEmptyDemo(undefined)).toThrow()
    expect(() => confirmEmptyDemo(true)).not.toThrow()
  })
  it('refuses credential paths inside a checkout even via symlinked parents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jcb-demo-path-test-')),
      checkout = join(dir, 'checkout')
    try {
      await mkdir(checkout)
      await mkdir(join(checkout, 'ignored'))
      await symlink(join(checkout, 'ignored'), join(dir, 'alias'))
      expect(
        await credentialsPath(join(dir, 'credentials.json'), checkout),
      ).toBe(join(dir, 'credentials.json'))
      for (const path of [
        undefined,
        'relative.json',
        join(checkout, 'credentials.json'),
        join(checkout, 'ignored', 'credentials.json'),
        join(dir, 'alias', 'credentials.json'),
      ])
        await expect(credentialsPath(path, checkout)).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('refuses unexpected schema objects before scanning business rows', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ name: 'jcb_portal_demo', local: true }],
      })
      .mockResolvedValueOnce({ rows: [{ unexpected: true }] })
    await expect(
      assertEmptyDemo({ query } as unknown as PoolClient),
    ).rejects.toThrow('Refusing unexpected schemas')
    expect(query).toHaveBeenCalledTimes(2)
  })
  it('permits only an explicit loopback listener override and keeps invalid configuration errors safe', () => {
    const env = {
      APP_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: demo.DEMO_DATABASE_URL,
      SESSION_SECRET: 'x'.repeat(32),
      LISTEN_HOST: '127.0.0.1',
    }
    expect(readConfig(env).LISTEN_HOST).toBe('127.0.0.1')
    expect(
      readConfig({ ...env, LISTEN_HOST: undefined }).LISTEN_HOST,
    ).toBeUndefined()
    expect(() => readConfig({ ...env, LISTEN_HOST: '0.0.0.0' })).toThrow(
      'Invalid environment configuration',
    )
  })
})
