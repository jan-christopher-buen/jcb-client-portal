function databaseUrl(value: string) {
  try {
    return new URL(value)
  } catch {
    throw new Error(
      'Invalid database URL. Check the local connection configuration.',
    )
  }
}
export function localDatabase(value: string | undefined, kind: 'dev' | 'test') {
  if (!value)
    throw new Error(
      `Missing ${kind === 'test' ? 'TEST_DATABASE_URL' : 'DATABASE_URL'}`,
    )
  const url = databaseUrl(value)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.search !== '' ||
    url.hash !== '' ||
    decodeURIComponent(url.pathname) !== `/jcb_portal_${kind}`
  ) {
    throw new Error(
      `Refusing database operation: requires a loopback jcb_portal_${kind} database.`,
    )
  }
  return value
}
export function testDatabase(env: NodeJS.ProcessEnv) {
  const value = localDatabase(env.TEST_DATABASE_URL, 'test')
  if (env.DATABASE_URL) {
    const dev = databaseUrl(env.DATABASE_URL),
      test = databaseUrl(value)
    if (dev.pathname === test.pathname)
      throw new Error('Test and development databases must differ.')
  }
  return value
}

export function demoDatabase(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== 'development' || env.JCB_LOCAL_DEMO !== '1')
    throw new Error(
      'Demo commands require NODE_ENV=development and JCB_LOCAL_DEMO=1.',
    )
  const value = env.DEMO_DATABASE_URL
  if (!value) throw new Error('Missing DEMO_DATABASE_URL.')
  const url = databaseUrl(value)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.search !== '' ||
    url.hash !== '' ||
    decodeURIComponent(url.pathname) !== '/jcb_portal_demo'
  )
    throw new Error(
      'Demo commands require a plain loopback jcb_portal_demo database URL.',
    )
  return value
}
