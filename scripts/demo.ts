import 'dotenv/config'
import { parseArgs } from 'node:util'
import { randomBytes } from 'node:crypto'
import { open } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync, spawn } from 'node:child_process'
import { Pool } from 'pg'
import { demoDatabase } from './database-safety.js'
import {
  confirmEmptyDemo,
  credentialsPath,
  assertEmptyDemo,
} from './demo-safety.js'
import { createDatabase } from '../apps/api/src/database.js'
import { buildDemo } from './demo-data.js'
const checkout = fileURLToPath(new URL('../', import.meta.url))
let pool: Pool | undefined, db: ReturnType<typeof createDatabase> | undefined
try {
  const command = process.argv[2],
    url = demoDatabase(process.env)
  if (command === 'seed') {
    const { values } = parseArgs({
      args: process.argv.slice(3),
      options: {
        'confirm-empty-demo': { type: 'boolean' },
        'credentials-file': { type: 'string' },
      },
    })
    confirmEmptyDemo(values['confirm-empty-demo'])
    const path = await credentialsPath(values['credentials-file'], checkout)
    pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000 })
    const client = await pool.connect()
    try {
      const lock = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext('jcb_local_demo_seed')) AS locked",
      )
      if (!lock.rows[0]?.locked)
        throw new Error('Another demo seed is running.')
      await assertEmptyDemo(client)
      // Exclusive creation refuses existing files/symlinks. Never print credentials.
      const file = await open(path, 'wx', 0o600)
      try {
        const migration = spawnSync('prisma', ['migrate', 'deploy'], {
          cwd: checkout,
          env: { ...process.env, DATABASE_URL: url },
          stdio: 'inherit',
        })
        if (migration.status !== 0) throw new Error('Demo migration failed.')
        await assertEmptyDemo(client)
        db = createDatabase(url)
        const result = await buildDemo(db)
        await file.writeFile(JSON.stringify(result, null, 2) + '\n')
        console.info(
          'Fictional demo seeded. Generated credentials are in the requested private file; passwords/tokens were not printed. Existing data is never replaced.',
        )
      } finally {
        await file.close()
      }
    } finally {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('jcb_local_demo_seed'))",
      )
      client.release()
    }
  } else if (command === 'dev') {
    console.info(
      'Local fictional demo: http://localhost:5173. Normal sign-in, authorization and CSRF apply. Session secret rotates on every launch.',
    )
    const child = spawn(
      'npm',
      [
        'exec',
        'concurrently',
        '--',
        '-k',
        '-n',
        'api,web',
        'npm run dev -w @jcb/api',
        'npm run dev -w @jcb/web',
      ],
      {
        cwd: checkout,
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'development',
          DATABASE_URL: url,
          APP_ORIGIN: 'http://localhost:5173',
          PORT: '3000',
          LISTEN_HOST: '127.0.0.1',
          SESSION_SECRET: randomBytes(48).toString('hex'),
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: '1025',
        },
      },
    )
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.on(signal, () => child.kill(signal))
    process.exitCode = await new Promise<number>((resolve) =>
      child.on('exit', (code) => resolve(code ?? 1)),
    )
  } else throw new Error('Expected seed or dev.')
} catch {
  // ORM/filesystem/process errors may include credentials or query parameters.
  console.error(
    'Local demo command refused or failed. Require development + JCB_LOCAL_DEMO=1, a plain loopback jcb_portal_demo URL, --confirm-empty-demo, an empty database and a new credentials file outside the checkout. No reset/replacement is performed. On failure, keep partial demo data for inspection; never use development/test/production data.',
  )
  process.exitCode = 1
} finally {
  await db?.$disconnect()
  await pool?.end()
}
