import { realpath } from 'node:fs/promises'
import {
  isAbsolute,
  resolve,
  relative,
  dirname,
  basename,
  sep,
} from 'node:path'
import type { PoolClient } from 'pg'
export function confirmEmptyDemo(confirmed: boolean | undefined) {
  if (!confirmed)
    throw new Error(
      'Explicit --confirm-empty-demo is required. Existing data is never replaced.',
    )
}
export async function credentialsPath(
  value: string | undefined,
  checkout: string,
) {
  if (!value || !isAbsolute(value))
    throw new Error(
      'Provide an absolute --credentials-file path outside the checkout.',
    )
  const parent = await realpath(dirname(value)),
    root = await realpath(checkout),
    path = resolve(parent, basename(value)),
    inside = relative(root, path)
  if (inside === '' || (!inside.startsWith('..' + sep) && !isAbsolute(inside)))
    throw new Error(
      'Credentials must be outside the checkout, including ignored directories.',
    )
  return path
}
export async function assertEmptyDemo(client: PoolClient) {
  const target = await client.query<{ name: string; local: boolean }>(
    "SELECT current_database() AS name, inet_server_addr() IS NULL OR inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr()='::1'::inet AS local",
  )
  if (target.rows[0]?.name !== 'jcb_portal_demo' || !target.rows[0]?.local)
    throw new Error('Refusing nonlocal or unexpected demo database.')
  // Refuse hidden/nonstandard data instead of querying views or foreign servers.
  const objects = await client.query<{ unexpected: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_')
     OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND (c.relkind IN ('v','m','f') OR c.relrowsecurity)) AS unexpected`,
  )
  if (objects.rows[0]?.unexpected)
    throw new Error(
      'Refusing unexpected schemas, views, foreign tables or row-security policies in the demo database.',
    )
  const tables = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations'",
  )
  for (const { tablename } of tables.rows) {
    const table = '"' + tablename.replaceAll('"', '""') + '"'
    const rows = await client.query<{ populated: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM public.${table} LIMIT 1) AS populated`,
    )
    if (rows.rows[0]?.populated)
      throw new Error(
        'Demo database is not empty. No existing data was changed; replacement/reset is not supported.',
      )
  }
}
