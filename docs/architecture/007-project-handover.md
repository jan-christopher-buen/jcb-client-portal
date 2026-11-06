# ADR-007: Handover and guarded completion

The existing project coordination now covers handover and completion. Prisma remains pinned to 7.10.1; dependencies are unchanged. This supersedes earlier descriptions of completion as unavailable and extends change resolution without changing approved proposals or agreed money.

## Authoritative gate

`GET /api/organizations/:orgId/projects/:projectId/completion-readiness` validates active membership and complete project ownership, then reads all current milestone, deliverable, change and checklist records in a repeatable-read snapshot. It does not use proposal/request display lists, history pages, latest-N decisions or client-supplied state. Blockers link to the relevant record; private checklist descriptions/titles and unpublished deliverable details never enter client blockers.

Completion requires In review, at least one required milestone/deliverable/checklist task, every required milestone Accepted with its current accepted round, every required deliverable's current PUBLISHED version carrying its own ACCEPTED decision, all required checklist tasks completed, and no unresolved changes/drafts. Optional delivery work need not be accepted. A deliverable revision draft preserves the accepted current version, as before; an unpublished change-offer draft blocks closure even if frozen by earlier approval.

Change terminal rules are explicit: IMPLEMENTED with its approved offer/receipt; DECLINED with no unfinished draft; or reasoned CLOSED for an unapproved request. OPEN, NEEDS_CLARIFICATION, OFFERED, APPROVED-unimplemented and all DRAFT offers block. Closing a request marks its drafts ABANDONED and supersedes pending offers, preserving their content. An owner can separately abandon a draft (including one frozen by an approved/implemented request) with a reason. Abandoned drafts remain owner-only, immutable and unpublishable. Approved requests cannot be closed; their implementation obligation cannot be bypassed.

## Transactions and history

`POST .../complete` accepts only explicit confirmation and expected project revision. Under the shared organization → enabled identity/current membership → project lock, it recomputes the full gate, inserts the next unique project/cycle snapshot, sets COMPLETED/UTC completed_at and appends detailed safe history plus generic activity. Snapshots reference milestone round IDs, deliverable version/decision IDs, checklist state/completion actor/time and change/approved-offer state. They contain no owner proposal/discovery notes or offer drafts. Identical completion retries while still completed return the existing cycle without duplicate completion events. After reopening, an old revision cannot accidentally complete a new cycle.

All milestone, deliverable, change, checklist and status writes use this same serializable project lock/revision and bounded four-attempt conflict retry. A competing invalidation that commits first makes the prior completion command stale; a retry must reread the gate. If completion wins, workflow mutations return conflicts. No external services run within transactions. Snapshot, project status/timestamp, project revision and activity commit or roll back together.

COMPLETED is readable but rejects workflow writes, including retries of earlier milestone/deliverable/change decisions. Generic status controls cannot hold/cancel a completed project. Only `POST .../reopen`, with current revision and a required reason, restores IN_REVIEW and clears the current completion timestamp. Earlier snapshots/events remain immutable. Cancellation remains terminal; hold still restores its valid prior state. Overdue excludes completed projects through the existing derived helper.

Additive database constraints enforce item bounds/completion actor-time shape, project completion timestamp consistency and unique cycles. Triggers protect snapshot/event/abandoned-offer immutability, completed workflow tables, and valid completion status transitions. The application remains the authorization and complete-readiness boundary; unrestricted SQL operators are trusted maintenance actors. There are no application history-deletion endpoints.

## Checklist and visibility

Tasks contain title, description, required flag, client visibility and stable order slots 1–100. Only owners create/edit/check/uncheck. All edits/check actions require a bounded reason. Editing any task clears its completion, so changed wording cannot silently inherit an earlier check. Required-flag changes on milestones/deliverables also require a reason and record before/after values in handover activity. Owner authority to change scope remains; exceptions are visible and auditable rather than treated as independent certification.

Checklist events preserve before/after task state. Private tasks and their events are omitted from client responses; a private required blocker is generic. Visibility-changing events require both before and after to be public before clients can read their details. Closure snapshots filter owner-only tasks on client reads; prior public history remains historical public information. Generic activity for private checklist actions is omitted. No secret fields or secret-delivery workflow exist; the UI explicitly forbids putting passwords/tokens/credentials in checklist text.

## Verification and bounds

Integration tests exercise independent API servers/Prisma pools and prove overlapping lock waits. Coverage includes individual/combined gates, empty required sets, historical/current acceptance, records beyond display limits, owner/client/isolation/revocation, required reasons, duplicate completion, completion against invalidation and status mutations, frozen-draft abandonment, immutable snapshots and injected-event rollback. Test cleanup targets only generated fixtures in the guarded dedicated test database.

Readiness is advisory; the UI displays blockers, checklist, owner confirmation/reopen controls and immutable completion cycles. Failed requests preserve text, pending refs prevent duplicate clicks, and role-appropriate actions remain server enforced. Checklist forms use browser memory; forced exit/reload does not preserve unsaved edits. Completion is workflow closure, not billing/payment, legal certification or verification of an external destination. Private storage/uploads, billing, AI, production mail, recovery/MFA and deployment remain excluded.
