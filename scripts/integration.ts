import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { testDatabase } from './database-safety.js'
const url = testDatabase(process.env)
const env = { ...process.env, NODE_ENV: 'test' }
for (const args of [
  ['prisma', 'migrate', 'deploy'],
  [
    'vitest',
    'run',
    '--no-file-parallelism',
    'apps/api/tests/session.integration.test.ts',
    'apps/api/tests/auth.integration.test.ts',
    'apps/api/tests/proposals.integration.test.ts',
    'apps/api/tests/workflow.integration.test.ts',
    'apps/api/tests/changes.integration.test.ts',
  ],
]) {
  const result = spawnSync(args[0]!, args.slice(1), {
    stdio: 'inherit',
    env: args[0] === 'prisma' ? { ...env, DATABASE_URL: url } : env,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
