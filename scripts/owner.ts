import 'dotenv/config'
import { parseArgs } from 'node:util'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { emailSchema, nameSchema, passwordSchema } from '@jcb/contracts'
import { confirmStaging } from './staging-safety.js'
import { localDatabase } from './database-safety.js'
import { createDatabase } from '../apps/api/src/database.js'
import { hashPassword } from '../apps/api/src/auth/password.js'
async function readPassword() {
  if (!process.stdin.isTTY) {
    let password = ''
    for await (const chunk of process.stdin) {
      password += String(chunk)
      if (Buffer.byteLength(password) > 1024)
        throw new Error('Password input exceeds limit.')
    }
    return password.replace(/\r?\n$/, '')
  }
  process.stdout.write('Owner password (12–128 characters, hidden): ')
  const muted = new Writable({
    write(_chunk, _encoding, done) {
      done()
    },
  })
  const input = createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  })
  try {
    return await input.question('')
  } finally {
    input.close()
    process.stdout.write('\n')
  }
}
let db: ReturnType<typeof createDatabase> | undefined
try {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      staging: { type: 'boolean', default: false },
    },
  })
  const email = emailSchema.parse(values.email),
    name = nameSchema.parse(values.name)
  const url = values.staging
    ? await confirmStaging(process.env)
    : localDatabase(process.env.DATABASE_URL, 'dev')
  const passwordHash = await hashPassword(
    passwordSchema.parse(await readPassword()),
  )
  db = createDatabase(url)
  if (await db.user.count({ where: { role: 'OWNER' } }))
    throw new Error('Owner already provisioned.')
  if (await db.user.findUnique({ where: { email } }))
    throw new Error('Email already has an account; no role was changed.')
  await db.user.create({ data: { email, name, passwordHash, role: 'OWNER' } })
  console.info('Owner created. Sign in with the supplied email and password.')
} catch {
  console.error(
    'Owner provisioning failed. Check the selected database access, unique email/owner, name, and a 12–128 character password. No existing account was upgraded.',
  )
  process.exitCode = 1
} finally {
  await db?.$disconnect()
}
