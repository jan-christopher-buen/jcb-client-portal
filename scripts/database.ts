import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { localDatabase } from './database-safety.js'
import { createDatabase } from '../apps/api/src/database.js'
const url = localDatabase(process.env.DATABASE_URL, 'dev')
if (process.argv[2] === 'migrate') {
  const result = spawnSync('prisma', ['migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  })
  process.exit(result.status ?? 1)
} else if (process.argv[2] === 'seed') {
  const db = createDatabase(url)
  try {
    await db.$queryRaw`SELECT 1`
    console.info(
      'Database connected. No accounts or business fixtures are seeded; use owner:create explicitly.',
    )
  } finally {
    await db.$disconnect()
  }
} else throw new Error('Expected migrate or seed')
