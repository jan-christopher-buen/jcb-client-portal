import { randomBytes } from 'node:crypto'
import type { PrismaClient } from '../apps/api/src/generated/prisma/client.js'
import { hashPassword } from '../apps/api/src/auth/password.js'
import {
  createInvitation,
  acceptInvitation,
} from '../apps/api/src/invitations/service.js'
import {
  createProposal,
  sendVersion,
  decideVersion as proposalDecision,
} from '../apps/api/src/proposals/service.js'
import {
  createMilestone,
  editMilestone,
  actMilestone,
  decideReview,
  readWorkflow,
  transitionProject,
} from '../apps/api/src/projects/service.js'
import {
  createChange,
  addMessage,
  draftOffer,
  editOffer,
  publishOffer,
  decideOffer,
  implementChange,
  readChange,
} from '../apps/api/src/changes/service.js'
import {
  createDeliverable,
  publishVersion,
  decideVersion,
  draftVersion,
  editVersion,
  readDeliverable,
} from '../apps/api/src/deliverables/service.js'
import {
  createItem,
  checkItem,
  readHandover,
  completeProject,
  reopenProject,
} from '../apps/api/src/handover/service.js'
import { manilaDate } from '@jcb/contracts'
// CLI-only fixture builder: all workflow transitions use the normal services.
export async function buildDemo(db: PrismaClient) {
  const accounts = [
    {
      name: 'Demo owner',
      email: 'owner@jcb-demo.example.test',
      role: 'OWNER' as const,
      password: randomBytes(24).toString('base64url'),
    },
    {
      name: 'Harbor reviewer',
      email: 'harbor@jcb-demo.example.test',
      role: 'CLIENT' as const,
      password: randomBytes(24).toString('base64url'),
    },
    {
      name: 'Luma reviewer',
      email: 'luma@jcb-demo.example.test',
      role: 'CLIENT' as const,
      password: randomBytes(24).toString('base64url'),
    },
  ]
  const owner = await db.user.create({
    data: {
      name: accounts[0]!.name,
      email: accounts[0]!.email,
      role: 'OWNER',
      passwordHash: await hashPassword(accounts[0]!.password),
    },
  })
  const projects = []
  for (const [index, organizationName] of [
    'Harbor Dental Studio (fictional demo)',
    'Luma Interiors (fictional demo)',
  ].entries()) {
    const account = accounts[index + 1]!,
      org = await db.organization.create({
        data: {
          name: organizationName,
          notes: 'Fictional demonstration only. Owner-only discovery notes.',
        },
      })
    await db.contact.create({
      data: {
        organizationId: org.id,
        name: account.name,
        email: account.email,
      },
    })
    let token = ''
    // Simulate delivery in memory, then consume through real email-bound onboarding.
    // No SMTP/network, token file, or retained raw token is involved in seeding.
    await createInvitation(
      db,
      async (mail) => {
        token = mail.token
      },
      org.id,
      account.email,
      owner.id,
    )
    await acceptInvitation(db, {
      token,
      name: account.name,
      password: account.password,
    })
    const client = await db.user.findUniqueOrThrow({
      where: { email: account.email },
    })
    const p = await createProposal(db, org.id, owner, {
      title: index === 0 ? 'Harbor website refresh' : 'Luma portfolio website',
      scope:
        'Five-page fictional business website, responsive layout and basic technical SEO.',
      exclusions:
        'Hosting, domains, subscriptions, payment collection and private storage.',
      deliveryAssumptions: 'Fictional client supplies approved copy.',
      internalNotes: 'Owner-only fictional discovery detail.',
      currency: 'PHP',
      items: [
        {
          description: 'Website implementation',
          quantity: 1,
          unitPriceMinor: '3500000',
        },
        {
          description: 'Text handover notes',
          quantity: 1,
          unitPriceMinor: '0',
        },
      ],
    })
    await sendVersion(db, org.id, p.proposalId, p.versionId, owner, 0)
    const approved = await proposalDecision(
        db,
        org.id,
        p.proposalId,
        p.versionId,
        client,
        'APPROVED',
      ),
      pid = approved.projectId!
    let workflow = await readWorkflow(db, org.id, pid, owner)
    await transitionProject(db, org.id, pid, owner, {
      action: 'ACTIVATE',
      expectedRevision: workflow.project.revision,
      reason: '',
    })
    const m = await createMilestone(db, org.id, pid, owner, {
      title: 'Website preview',
      description:
        'Review fictional page copy, responsive layout and navigation.',
      dueDate: manilaDate(new Date(Date.now() + 7 * 86400000)),
      required: true,
      position: 1,
    })
    await actMilestone(db, org.id, pid, m.milestoneId, owner, {
      action: 'START',
      expectedRevision: 0,
      reason: '',
    })
    const round = await actMilestone(db, org.id, pid, m.milestoneId, owner, {
      action: 'SUBMIT',
      expectedRevision: 1,
      reason: '',
    })
    await decideReview(
      db,
      org.id,
      pid,
      m.milestoneId,
      round.reviewId!,
      client,
      {
        outcome: 'CHANGES_REQUESTED',
        feedback: 'Please clarify the introductory heading.',
      },
    )
    await editMilestone(
      db,
      org.id,
      pid,
      m.milestoneId,
      owner,
      {
        title: 'Website preview',
        description:
          'Revised introductory heading and fictional responsive page copy.',
        dueDate: manilaDate(new Date(Date.now() + 7 * 86400000)),
        required: true,
        position: 1,
      },
      3,
    )
    await actMilestone(db, org.id, pid, m.milestoneId, owner, {
      action: 'SUBMIT',
      expectedRevision: 4,
      reason: '',
    })
    workflow = await readWorkflow(db, org.id, pid, owner)
    await decideReview(
      db,
      org.id,
      pid,
      m.milestoneId,
      workflow.milestones[0]!.currentReviewId!,
      client,
      { outcome: 'ACCEPTED', feedback: 'Revised heading is clear.' },
    )
    const request = await createChange(db, org.id, pid, client, {
      title: 'Appointment introduction',
      requestedChange: 'Add explanatory appointment copy.',
      businessContext: 'Explain how fictional appointments are requested.',
    })
    await addMessage(db, org.id, pid, request.requestId, owner, {
      kind: 'CLARIFICATION',
      body: 'Is this descriptive copy only, without a booking integration?',
      expectedRevision: 0,
    })
    await addMessage(db, org.id, pid, request.requestId, client, {
      kind: 'RESPONSE',
      body: 'Yes, copy only. No integration or date changes.',
      expectedRevision: 1,
    })
    const offer = await draftOffer(db, org.id, pid, request.requestId, owner, 2)
    await editOffer(
      db,
      org.id,
      pid,
      request.requestId,
      offer.offerId,
      owner,
      {
        scope: 'Appointment introduction copy on the existing page.',
        exclusions: 'No booking service or extra page.',
        adjustmentMinor: '150000',
        scheduleImpact:
          'No date changes. Owner changes dates separately if needed.',
      },
      0,
    )
    await publishOffer(
      db,
      org.id,
      pid,
      request.requestId,
      offer.offerId,
      owner,
      1,
    )
    await decideOffer(
      db,
      org.id,
      pid,
      request.requestId,
      offer.offerId,
      client,
      'APPROVED',
    )
    const d = await createDeliverable(db, org.id, pid, owner, {
      title: 'Website text and public example',
      description:
        'Fictional delivered copy. External example is public and is not a privately hosted client file.',
      links: [
        { label: 'Public fictional example', url: 'https://example.com/' },
      ],
      required: true,
      position: 1,
    })
    await publishVersion(db, org.id, pid, d.deliverableId, d.versionId, owner, {
      expectedRevision: 0,
      expectedDeliverableRevision: 0,
      reason: '',
    })
    await decideVersion(db, org.id, pid, d.deliverableId, d.versionId, client, {
      outcome: 'CHANGES_REQUESTED',
      feedback: 'Please include the revised appointment introduction.',
    })
    let detail = await readDeliverable(db, org.id, pid, d.deliverableId, owner)
    const next = await draftVersion(
      db,
      org.id,
      pid,
      d.deliverableId,
      owner,
      detail.deliverable.revision,
    )
    await editVersion(
      db,
      org.id,
      pid,
      d.deliverableId,
      next.versionId,
      owner,
      {
        title: 'Revised website text and public example',
        description:
          'Fictional revised copy includes the appointment introduction. Text-only handover.',
        links: [
          { label: 'Public fictional example', url: 'https://example.com/' },
        ],
      },
      0,
    )
    detail = await readDeliverable(db, org.id, pid, d.deliverableId, owner)
    await publishVersion(
      db,
      org.id,
      pid,
      d.deliverableId,
      next.versionId,
      owner,
      {
        expectedRevision: 1,
        expectedDeliverableRevision: detail.deliverable.revision,
        reason: 'Responded to client feedback.',
      },
    )
    const task = await createItem(db, org.id, pid, owner, {
      title: 'Confirm documentation handover',
      description:
        'Confirm fictional text documentation was reviewed. Never add credentials here.',
      required: true,
      clientVisible: true,
      position: 1,
    })
    await createItem(db, org.id, pid, owner, {
      title: 'Owner follow-up reminder',
      description:
        'Fictional private administrative note, without credentials.',
      required: false,
      clientVisible: false,
      position: 2,
    })
    if (index === 1) {
      const change = await readChange(db, org.id, pid, request.requestId, owner)
      await implementChange(
        db,
        org.id,
        pid,
        request.requestId,
        owner,
        change.request.revision,
        'Appointment copy implemented and checked.',
      )
      await decideVersion(
        db,
        org.id,
        pid,
        d.deliverableId,
        next.versionId,
        client,
        { outcome: 'ACCEPTED', feedback: 'Current version reviewed.' },
      )
      await checkItem(db, org.id, pid, task.itemId, owner, {
        completed: true,
        expectedRevision: 0,
        reason: 'Documentation handover recorded.',
      })
      workflow = await readWorkflow(db, org.id, pid, owner)
      await transitionProject(db, org.id, pid, owner, {
        action: 'REVIEW',
        expectedRevision: workflow.project.revision,
        reason: '',
      })
      let h = await readHandover(db, org.id, pid, owner)
      await completeProject(db, org.id, pid, owner, h.project.revision)
      h = await readHandover(db, org.id, pid, owner)
      await reopenProject(
        db,
        org.id,
        pid,
        owner,
        h.project.revision,
        'Repeat the fictional handover confirmation.',
      )
      await checkItem(db, org.id, pid, task.itemId, owner, {
        completed: false,
        expectedRevision: 1,
        reason: 'Repeat documentation confirmation.',
      })
      await checkItem(db, org.id, pid, task.itemId, owner, {
        completed: true,
        expectedRevision: 2,
        reason: 'Follow-up handover recorded.',
      })
      h = await readHandover(db, org.id, pid, owner)
      await completeProject(db, org.id, pid, owner, h.project.revision)
    }
    projects.push({
      organization: org.name,
      organizationId: org.id,
      projectId: pid,
      path: `/organizations/${org.id}/projects/${pid}`,
      expectedStatus: index === 0 ? 'ACTIVE' : 'COMPLETED',
    })
  }
  return {
    notice:
      'Local fictional demonstration credentials. Do not commit, share publicly or reuse these passwords.',
    accounts,
    projects,
  }
}
