import { createInterface } from 'node:readline/promises'

// Separate from the loopback-only development/test/demo policies.
export function stagingDatabase(env: NodeJS.ProcessEnv) {
  const fail = () => {
    throw new Error(
      'Staging operation refused. Check explicit staging configuration.',
    )
  }
  let url: URL
  try {
    url = new URL(env.DATABASE_URL ?? '')
  } catch {
    return fail()
  }
  if (
    env.NODE_ENV !== 'production' ||
    env.JCB_STAGING !== '1' ||
    !env.STAGING_DATABASE_HOST ||
    url.hostname !== env.STAGING_DATABASE_HOST ||
    !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(url.hostname) ||
    url.hostname.split('.')[0]?.endsWith('-pooler') ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.pathname !== '/jcb_portal_staging' ||
    url.port !== '5432' ||
    !url.username ||
    !url.password ||
    url.hash ||
    url.searchParams.get('sslmode') !== 'verify-full' ||
    [...url.searchParams.keys()].some((key) => key !== 'sslmode') ||
    [...url.searchParams.keys()].length !== 1
  )
    return fail()
  return url.href
}
export async function confirmStaging(env: NodeJS.ProcessEnv) {
  const url = stagingDatabase(env)
  if (!process.stdin.isTTY)
    throw new Error('Staging operations require an interactive terminal.')
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    const expected = `staging ${new URL(url).hostname}/jcb_portal_staging`
    if ((await input.question(`Type ${expected} to continue: `)) !== expected)
      throw new Error('Staging confirmation did not match.')
  } finally {
    input.close()
  }
  return url
}
