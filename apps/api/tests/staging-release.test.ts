import { afterAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readConfig } from '../src/config.js'
const guard = fileURLToPath(
  new URL('../../../scripts/check-staging-release.mjs', import.meta.url),
)
const sha = 'a'.repeat(40)
describe('staging release build gate', () => {
  it.each(['a'.repeat(40), 'b'.repeat(40)])(
    'accepts independently approved future SHA %s',
    (approved) => {
      const result = spawnSync(process.execPath, [guard], {
        env: {
          JCB_RELEASE_SHA: approved,
          RENDER_GIT_COMMIT: approved,
          PATH: '',
        },
      })
      expect(result.status).toBe(0)
    },
  )
  it.each([
    {},
    { RENDER_GIT_COMMIT: sha },
    { JCB_RELEASE_SHA: sha },
    { JCB_RELEASE_SHA: sha, RENDER_GIT_COMMIT: 'b'.repeat(40) },
    { JCB_RELEASE_SHA: 'short', RENDER_GIT_COMMIT: 'short' },
    { JCB_RELEASE_SHA: 'A'.repeat(40), RENDER_GIT_COMMIT: 'A'.repeat(40) },
    { JCB_RELEASE_SHA: sha + '\n', RENDER_GIT_COMMIT: sha + '\n' },
  ])(
    'fails closed for missing, malformed or mismatched release settings: %j',
    (env) => {
      const result = spawnSync(process.execPath, [guard], {
        env: { ...env, PATH: '' },
        encoding: 'utf8',
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Staging build refused')
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toContain(sha)
    },
  )
})
const fixture = mkdtempSync(join(tmpdir(), 'jcb-staging-start-'))
// Harmless replacement for npm: inspect only the origin passed by the real
// tracked start command. It never starts the application or contacts a database.
writeFileSync(
  join(fixture, 'npm'),
  '#!/bin/sh\nif [ "$1" = start ]; then printf "%s" "$APP_ORIGIN"; else printf "%s\\n" "$*" >> "$JCB_TEST_NPM_LOG"; fi\n',
  { mode: 0o700 },
)
afterAll(() => rmSync(fixture, { recursive: true, force: true }))
const blueprint = readFileSync(
  new URL('../../../render.yaml', import.meta.url),
  'utf8',
)
const command = blueprint.match(/^ {4}startCommand: (.+)$/m)?.[1]
describe('tracked assigned-origin start command', () => {
  it.each([
    'https://fictional.onrender.com',
    '',
    'http://fictional.onrender.com',
    'https://fictional.onrender.com/path',
    'https://fictional.onrender.com/',
  ])(
    'uses only the assigned URL and preserves production origin validation: %s',
    (origin) => {
      expect(command).toBeDefined()
      const result = spawnSync('/bin/sh', ['-c', command!], {
        env: {
          PATH: fixture,
          RENDER_EXTERNAL_URL: origin,
          APP_ORIGIN: 'https://stale.example.test',
        },
        encoding: 'utf8',
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe(origin)
      const validate = () =>
        readConfig({
          NODE_ENV: 'production',
          APP_ORIGIN: result.stdout,
          SESSION_SECRET: 'x'.repeat(32),
          DATABASE_URL:
            'postgresql://fictional:placeholder@example.test/staging?sslmode=verify-full',
        })
      if (origin === 'https://fictional.onrender.com')
        expect(validate().APP_ORIGIN).toBe(origin)
      else expect(validate).toThrow()
    },
  )
})

it('the tracked build command blocks package installation until the release matches', () => {
  writeFileSync(
    join(fixture, 'node'),
    '#!/bin/sh\nexec "$JCB_TEST_NODE" "$@"\n',
    { mode: 0o700 },
  )
  const log = join(fixture, 'npm-calls')
  const build = blueprint.match(/^ {4}buildCommand: (.+)$/m)?.[1]
  expect(build).toBeDefined()
  const env = {
    PATH: fixture,
    JCB_TEST_NODE: process.execPath,
    JCB_TEST_NPM_LOG: log,
    JCB_RELEASE_SHA: sha,
  }
  const run = (actual: string) =>
    spawnSync('/bin/sh', ['-c', build!], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: { ...env, RENDER_GIT_COMMIT: actual },
      encoding: 'utf8',
    })
  expect(run('b'.repeat(40)).status).toBe(1)
  expect(existsSync(log)).toBe(false)
  expect(run(sha).status).toBe(0)
  expect(readFileSync(log, 'utf8')).toBe('ci --include=dev\nrun build\n')
})
