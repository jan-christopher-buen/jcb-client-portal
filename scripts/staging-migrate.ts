import { spawnSync } from 'node:child_process'
import { confirmStaging } from './staging-safety.js'
try {
  const url = await confirmStaging(process.env)
  const result = spawnSync('prisma', ['migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  })
  process.exitCode = result.status ?? 1
} catch {
  console.error(
    'Staging migration refused or failed. No reset or seed was requested.',
  )
  process.exitCode = 1
}
