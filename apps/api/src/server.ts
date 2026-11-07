import { Pool } from 'pg'
import { createApp } from './app.js'
import { readConfig } from './config.js'
const config = readConfig(process.env)
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
})
pool.on('error', () => console.error('Database connection failed'))
const { app, store, db } = createApp(config, pool)
const listening = () => console.info(`jcb API listening on port ${config.PORT}`)
const server = config.LISTEN_HOST
  ? app.listen(config.PORT, config.LISTEN_HOST, listening)
  : app.listen(config.PORT, '0.0.0.0', listening)
let closing = false
function shutdown() {
  if (closing) return
  closing = true
  const timer = setTimeout(() => process.exit(1), 10000).unref()
  server.close(() => {
    store.close()
    void Promise.all([pool.end(), db.$disconnect()]).then(() => {
      clearTimeout(timer)
    })
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
