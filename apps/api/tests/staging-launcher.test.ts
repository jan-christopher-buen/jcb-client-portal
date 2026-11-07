import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { confirmStaging } from '../../../scripts/staging-safety.js'
import { runStagingMigration } from '../../../scripts/staging-migration-launcher.js'
vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
vi.mock('../../../scripts/staging-safety.js', () => ({
  confirmStaging: vi.fn(),
}))
const checkout = fileURLToPath(new URL('../../../', import.meta.url))
const secret = 'postgresql://fictional:PRIVATE_PASSWORD@example.test/staging'
const success = {
  pid: 1,
  status: 0,
  signal: null,
  output: [],
  stdout: Buffer.from(secret),
  stderr: Buffer.from(secret),
}
let error: ReturnType<typeof vi.spyOn>, info: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.mocked(confirmStaging).mockResolvedValue(secret)
  vi.mocked(spawnSync).mockReturnValue(success)
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
  info = vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
})
describe('guarded project-local staging migration launcher', () => {
  it('uses this checkout’s installed CLI/config and Node, independently of PATH and caller cwd', async () => {
    const env = { PATH: '/no-prisma-here', DATABASE_URL: 'unconfirmed-value' }
    expect(await runStagingMigration(env)).toBe(0)
    expect(confirmStaging).toHaveBeenCalledWith(env)
    expect(spawnSync).toHaveBeenCalledExactlyOnceWith(
      process.execPath,
      [
        resolve(checkout, 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        resolve(checkout, 'prisma.config.ts'),
      ],
      expect.objectContaining({
        cwd: checkout,
        env: { ...env, DATABASE_URL: secret },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    )
    expect(JSON.stringify(info.mock.calls)).not.toContain('PRIVATE_PASSWORD')
  })
  it('launches the actual installed Prisma with an empty PATH in harmless help mode', async () => {
    const real =
      await vi.importActual<typeof import('node:child_process')>(
        'node:child_process',
      )
    vi.mocked(spawnSync).mockImplementation((command, args, options) =>
      // Exercise the real executable, retaining all launcher arguments, but
      // append help so even the fictional confirmed URL is never contacted.
      real.spawnSync(command, [...(args ?? []), '--help'], {
        ...options,
        encoding: 'buffer',
        timeout: 10000,
      }),
    )
    expect(await runStagingMigration({ PATH: '' })).toBe(0)
    expect(error).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith('Staging migrations completed.')
  })
  it('never resolves/launches Prisma after confirmation fails', async () => {
    vi.mocked(confirmStaging).mockRejectedValue(new Error(secret))
    expect(await runStagingMigration({})).toBe(1)
    expect(spawnSync).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      'Staging migration refused. No migration was launched.',
    )
    expect(JSON.stringify(error.mock.calls)).not.toContain(secret)
  })
  it.each([
    {
      ...success,
      status: null,
      error: Object.assign(new Error(secret), { code: 'ENOENT' }),
    },
    { ...success, status: null, signal: 'SIGTERM' as const },
    { ...success, status: 7 },
    { ...success, status: null },
  ])(
    'reports unsuccessful child outcomes without leaking output or errors: $status/$signal',
    async (result) => {
      vi.mocked(spawnSync).mockReturnValue(result)
      expect(await runStagingMigration({})).toBe(result.status === 7 ? 7 : 1)
      expect(error).toHaveBeenCalledOnce()
      expect(JSON.stringify(error.mock.calls)).not.toContain('PRIVATE_PASSWORD')
      expect(info).not.toHaveBeenCalled()
    },
  )
  it('sanitizes a thrown launch error', async () => {
    vi.mocked(spawnSync).mockImplementation(() => {
      throw new Error(secret)
    })
    expect(await runStagingMigration({})).toBe(1)
    expect(error).toHaveBeenCalledOnce()
    expect(JSON.stringify(error.mock.calls)).not.toContain('PRIVATE_PASSWORD')
  })
})
