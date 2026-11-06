import type { Prisma, Project } from '../generated/prisma/client.js'
export async function handoverEvent(
  tx: Prisma.TransactionClient,
  p: Project,
  actor: Express.User,
  kind: Prisma.HandoverEventCreateManyInput['kind'],
  targetId: string,
  reason: string,
  details: Prisma.InputJsonValue,
  clientVisible = true,
) {
  const e = await tx.handoverEvent.create({
    data: {
      projectId: p.id,
      organizationId: p.organizationId,
      actorId: actor.id,
      kind,
      targetId,
      reason,
      details,
      clientVisible,
    },
  })
  // Private checklist actions stay out of generic client-visible activity.
  if (clientVisible)
    await tx.activityEvent.create({
      data: {
        organizationId: p.organizationId,
        actorId: actor.id,
        kind,
        targetId: e.id,
      },
    })
}
