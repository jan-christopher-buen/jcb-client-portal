import { afterAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import { Pool } from 'pg'
import { createDatabase } from '../src/database.js'
import { testDatabase } from '../../../scripts/database-safety.js'
const url = testDatabase(process.env)
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000 })
const Store = connectPgSimple(session)
const store = new Store({ pool, createTableIfMissing: false })
const db = createDatabase(url)
const sid = `foundation-test-${randomUUID()}`
afterAll(async () => {
  await db.session.deleteMany({ where: { sid } })
  store.close()
  await pool.end()
  await db.$disconnect()
})
it('persists, reads and destroys sessions through the migrated PostgreSQL store', async () => {
  const data = {
    cookie: {
      expires: new Date(Date.now() + 60000),
      originalMaxAge: 60000,
      httpOnly: true,
      path: '/',
    },
  } as session.SessionData
  await new Promise<void>((resolve, reject) =>
    store.set(sid, data, (error) => (error ? reject(error) : resolve())),
  )
  expect(await db.session.count({ where: { sid } })).toBe(1)
  const saved = await new Promise<session.SessionData | null | undefined>(
    (resolve, reject) =>
      store.get(sid, (error, value) =>
        error ? reject(error) : resolve(value),
      ),
  )
  expect(saved?.cookie.httpOnly).toBe(true)
  await new Promise<void>((resolve, reject) =>
    store.destroy(sid, (error) => (error ? reject(error) : resolve())),
  )
  expect(await db.session.count({ where: { sid } })).toBe(0)
})
