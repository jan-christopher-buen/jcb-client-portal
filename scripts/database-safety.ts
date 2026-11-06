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
