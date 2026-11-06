import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { Pool } from 'pg'
import { createApp } from '../src/app.js'
import { readConfig } from '../src/config.js'
const config = readConfig({
  APP_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://localhost/jcb_portal_test',
  SESSION_SECRET: 'a'.repeat(32),
  NODE_ENV: 'test',
})
const pool = new Pool({ connectionString: config.DATABASE_URL })
const { app, store, db } = createApp(config, pool)
afterAll(async () => {
  store.close()
  await pool.end()
  await db.$disconnect()
})
describe('public foundation', () => {
  it('reports minimal liveness without database access', async () => {
    const response = await request(app).get('/health')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
    expect(response.headers['x-powered-by']).toBeUndefined()
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'self'",
    )
  })
  it('never authorizes a supplied identity or creates an anonymous session', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('X-User-Role', 'OWNER')
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHENTICATED')
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.headers['cache-control']).toBe('no-store')
  })
  it('rejects login without CSRF protection', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@example.test', password: 'secret' })
    expect(response.status).toBe(403)
  })
  it('returns safe errors for malformed JSON and unknown routes', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{')
    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      error: { code: 'INVALID_JSON', message: 'Invalid JSON body.' },
    })
    expect((await request(app).get('/api/unknown')).status).toBe(404)
  })
})
