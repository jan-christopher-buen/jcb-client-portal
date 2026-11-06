import type { PrismaClient } from '../generated/prisma/client.js'
import { z } from 'zod'
import { notFound } from '../errors.js'
export const uuid = (value: unknown) => z.string().uuid().parse(value)
export async function accessibleOrganization(
  db: PrismaClient,
  id: string,
  user: Express.User,
) {
  const organization = await db.organization.findFirst({
    where: {
      id,
      ...(user.role === 'OWNER'
        ? {}
        : {
            archivedAt: null,
            memberships: { some: { userId: user.id, revokedAt: null } },
          }),
    },
  })
  if (!organization) throw notFound()
  return organization
}
