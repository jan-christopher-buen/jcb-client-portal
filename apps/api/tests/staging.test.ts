import { describe, expect, it } from 'vitest'
import { readConfig } from '../src/config.js'
import { stagingDatabase } from '../../../scripts/staging-safety.js'
const host = 'ep-fictional-example.us-east-2.aws.neon.tech'
const staging = {
  NODE_ENV: 'production',
  JCB_STAGING: '1',
  STAGING_DATABASE_HOST: host,
  DATABASE_URL: `postgresql://fictional:placeholder@${host}:5432/jcb_portal_staging?sslmode=verify-full`,
}
const runtime = {
  ...staging,
  APP_ORIGIN: 'https://fictional.onrender.com',
  SESSION_SECRET: 'x'.repeat(32),
}
describe('staging boundaries', () => {
  it('requires the exact direct staging database, verified TLS and explicit configuration', () => {
    expect(stagingDatabase(staging)).toBe(staging.DATABASE_URL)
    for (const patch of [
      { JCB_STAGING: undefined },
      { NODE_ENV: 'development' },
      { STAGING_DATABASE_HOST: 'other.neon.tech' },
      ...[
        staging.DATABASE_URL.replace('verify-full', 'require'),
        staging.DATABASE_URL.replace(
          host,
          host.replace('example.', 'example-pooler.'),
        ),
        staging.DATABASE_URL.replace('jcb_portal_staging', 'jcb_portal_dev'),
        staging.DATABASE_URL.replace(host, 'localhost'),
        staging.DATABASE_URL + '&host=elsewhere',
        staging.DATABASE_URL + '&sslmode=disable',
      ].map((DATABASE_URL) => ({ DATABASE_URL })),
    ])
      expect(() => stagingDatabase({ ...staging, ...patch })).toThrow(
        'Staging operation refused',
      )
  })
  it('rejects unverified TLS and limits proxy opt-in to Render production', () => {
    expect(readConfig(runtime).TRUST_PROXY).toBe('off')
    expect(
      readConfig({ ...runtime, RENDER: 'true', TRUST_PROXY: 'render-edge' })
        .TRUST_PROXY,
    ).toBe('render-edge')
    expect(() =>
      readConfig({ ...runtime, TRUST_PROXY: 'render-edge' }),
    ).toThrow()
    for (const suffix of [
      '?sslmode=require',
      '?sslmode=no-verify',
      '?sslmode=verify-full&sslrootcert=secret',
      '?sslmode=verify-full&host=elsewhere',
    ])
      expect(() =>
        readConfig({
          ...runtime,
          DATABASE_URL: runtime.DATABASE_URL.split('?')[0] + suffix,
        }),
      ).toThrow()
  })
})
