import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { confirmStaging } from './staging-safety.js'

const checkout = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(resolve(checkout, 'package.json'))

export async function runStagingMigration(env: NodeJS.ProcessEnv) {
  let url: string
  try {
    url = await confirmStaging(env)
  } catch {
    console.error('Staging migration refused. No migration was launched.')
    return 1
  }
  try {
    // Explicit relative resolution cannot fall back to PATH or a global package.
    const cli = require.resolve('./node_modules/prisma/build/index.js')
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'migrate',
        'deploy',
        '--config',
        resolve(checkout, 'prisma.config.ts'),
      ],
      {
        cwd: checkout,
        env: { ...env, DATABASE_URL: url },
        // Never echo arbitrary child output: it can contain connection secrets.
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024,
      },
    )
    if (result.error) {
      console.error(
        'Could not launch or capture project-local Prisma. Check the local Node/Prisma installation.',
      )
      return 1
    }
    if (result.signal) {
      console.error(
        'Staging migration was terminated by a signal. Inspect database migration status before retrying.',
      )
      return 1
    }
    if (result.status !== 0) {
      console.error(
        'Staging migration failed. Inspect database migration status privately before retrying.',
      )
      return result.status && result.status > 0 && result.status <= 255
        ? result.status
        : 1
    }
    console.info('Staging migrations completed.')
    return 0
  } catch {
    console.error(
      'Project-local Prisma launch failed. Check the checkout and installed dependencies.',
    )
    return 1
  }
}
