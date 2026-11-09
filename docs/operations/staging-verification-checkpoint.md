# Staging verification checkpoint

Evidence recorded November 8–9, 2026 (Asia/Singapore). This checkpoint covers a restricted, fictional-data staging deployment on Render Free in Singapore with a dedicated Neon PostgreSQL 18 database. It is not production readiness, a public demo, or completion of the original full MVP. Private uploads/storage remain deferred.

This document summarizes observed results. Private operator transcripts, credentials, account addresses, database dumps and diagnostic artifacts are intentionally excluded. User-operated browser observations are distinguished from HTTP helper results and read-only database checks.

## Release and CI evidence

The deployed release was reconfirmed as [`94aa209c325bb70a0b83133003fe17c717a794a2`](https://github.com/jan-christopher-buen/jcb-client-portal/commit/94aa209c325bb70a0b83133003fe17c717a794a2). Its [GitHub Actions run](https://github.com/jan-christopher-buen/jcb-client-portal/actions/runs/42432426687) passed. This verifies that release, not CI for this later documentation branch; branch CI remains pending until separately pushed and executed.

The same SHA was redeployed once with the existing build cache retained (`do_not_clear`). Render recorded successful completion at 19:59:41 on November 8. Subsequent hosted checks observed one visible instance, health JSON 200, frontend and sign-in SPA 200, a referenced frontend asset 200, and anonymous protected API 401. Private environment values matched the operator-recorded release inputs before and after that deployment. Render's deployment detail does not expose an immutable environment snapshot, so this was a comparison with release records rather than introspection of process environment.

## Onboarding and membership history

- The operator completed normal invitation onboarding in a private browser. Read-only checks found a consumed, non-revoked invitation, an active CLIENT account, exactly one active membership in the first fictional organization, and matching acceptance/activation audit records.
- The same existing CLIENT accepted an invitation to a second fictional organization. Database checks established account reuse without a duplicate account and exactly one active membership in each organization. The operator confirmed browser access to both organizations.
- The second organization's membership revocation is preserved as an owner-attributed audit event. A subsequently reissued invitation revoked an older unconsumed invitation. The operator observed the old link being rejected and accepted its replacement. Database checks confirmed the old invitation remained revoked/unconsumed, the replacement was consumed/not revoked, and the existing membership was reactivated with consistent client acceptance/activation events.
- Provider acceptance and inbox receipt were treated separately: delivery metadata recorded acceptance; actual email opening/onboarding was operator-observed. This one-inbox test does not establish unrestricted production delivery or isolation between distinct client identities.

Direct protected-API denial while that membership was revoked was not captured as a completed hosted checkpoint. The final restored snapshot contains the later reactivated membership; it cannot itself prove what the earlier browser/API response was.

See [authentication and invitations](../architecture/002-authentication-and-invitations.md) and [invitation email delivery](../architecture/009-invitation-email.md).

## Hosted logout and cookie replay

A private terminal helper used two independent sessions for an existing account. Credential prompts were hidden; cookies/tokens stayed in memory and only sanitized statuses were retained. Both logins and pre-logout protected reads returned 200. Primary logout returned 204; subsequent protected access and replay of its old cookie returned 401. Direct SPA navigation returned HTML 200 while the protected API stayed 401, including after anonymous CSRF refresh and another old-cookie replay. The independent session still returned 200; its cleanup logout returned 204 and protected access then returned 401.

These are hosted HTTP checks, not browser UI reload tests. No automatic login/logout retries occurred. The delayed-session-save race was not instrumented on staging. Existing local regression coverage is separate evidence and was not rerun as part of this hosted test. See [session/request boundaries](../architecture/008-request-boundaries.md).

## Business workflow

The operator used separate owner/client browser profiles. Every checkpoint below was followed by read-only staging verification before continuing:

1. Owner published proposal v1 for PHP 1,000.00: one item, quantity 1, unit price 100000 centavos. Current sent version, owner publication event and absence of a decision/project were verified before approval. The enabled snapshot guard matched the reviewed migration; no mutation was attempted to test immutability.
2. The active CLIENT approved v1. One decision and exactly one planned project referenced the correct organization/proposal/version. Original snapshot fingerprints remained unchanged through the journey.
3. Owner activated the project, created one required milestone, started it and submitted round 1. The client accepted its current immutable snapshot; progress became 1/1 required milestones accepted. Actor, version/round and transition audit relationships matched.
4. Client created one scope-change request. Owner saved and published offer v1 for +25000 centavos; the draft/pending offer did not affect agreed totals. Client approval produced PHP 1,250.00 agreed scope: original 100000 + approved adjustment 25000 = 125000 centavos. Owner recorded implementation with a client-visible note. No milestone date shifted.
5. Owner created and published one required text-only deliverable v1 with no external links. Client accepted that current version. Publication content and version-specific decision history were preserved.
6. Owner created one required, client-visible handover task and marked it complete with a reason. Readiness remained blocked while the project was Active; after the owner moved it to In review, read-only checks found accepted required records, an implemented approved change, no unfinished offer drafts and no incomplete required checklist item.
7. Owner completed the project, explicitly reopened it with a reason, and completed it again. Two distinct owner-attributed completion receipts, cycles 1 and 2, and one intervening reopening event were verified. Cycle 1 was unchanged; both snapshots matched the preserved workflow and final authoritative records.

The final project is Completed with exactly one accepted required milestone, one accepted required deliverable, one implemented approved change and one completed required handover task. There is still exactly one project for the proposal; the original PHP 1,000.00 proposal remains unchanged and the revised agreement is PHP 1,250.00.

An early activation attempt returned “Owner access required” while the screen showed cached owner details. No transition had been recorded; the operator subsequently activated successfully in the owner context. Session sharing across tabs was a possible explanation, not an established root cause. Separate profiles were used for subsequent role-specific actions.

Scope approval, owner-recorded implementation, client deliverable acceptance and owner-confirmed workflow completion are distinct records. Completion does not represent payment, legal certification, or independent verification of work/files.

Related designs: [proposals](../architecture/003-proposal-approval.md), [project/milestone lifecycle](../architecture/004-project-milestones.md), [change requests](../architecture/005-change-requests.md), [deliverable reviews](../architecture/006-deliverable-reviews.md), and [handover/completion](../architecture/007-project-handover.md).

## Completed-state write rejection

A controlled private HTTP run authenticated existing owner/client accounts and confirmed protected reads returned 200 for the Completed project. It attempted each of the following once:

| Existing-record write                                                                            | Observed result      |
| ------------------------------------------------------------------------------------------------ | -------------------- |
| Owner POST to `/handover/items/:itemId/check`, requesting uncheck                                | 409 `PROJECT_PAUSED` |
| Client POST to `/milestones/:milestoneId/reviews/:reviewId/decision`, repeating acceptance       | 409 `PROJECT_PAUSED` |
| Client POST to `/deliverables/:deliverableId/versions/:versionId/decision`, repeating acceptance | 409 `PROJECT_PAUSED` |

Paths are relative to the scoped organization/project API route. The client decision probes repeated the existing decision/feedback; they did not exercise a new pending review. All three were rejected by the completed-project guard rather than accepted as idempotent retries.

Read-only before/after comparisons of 20 business/audit tables found no changed records, revisions, snapshots or history. The project remained Completed at revision 20 with two completion receipts. Both test-session cleanup logouts returned 204. Sessions/throttling were intentionally outside the business baseline because authentication legitimately changes them.

A previous attempt stopped on an anonymous CSRF GET timeout before login or any write probe. Its failed report and old baseline were preserved privately; the guard was deliberately reviewed before a fresh baseline and one retry. Separate three-GET diagnostics later observed health 200/0.286 s, anonymous CSRF 200/0.221 s and health 200/0.193 s. Those successes did not explain the earlier timeout. No mutation retries or automatic guard bypass were used.

## Fresh consistent backup and populated restore

On November 9 a fresh custom-format backup was created with an exported PostgreSQL read-only snapshot. Migration checksums and source counts were collected from that same snapshot. Archive SHA-256 integrity and archive listing were checked before restoration and integrity was rechecked afterward.

The archive was restored into a newly created isolated local PostgreSQL 18 cluster, never over an existing database or into Neon. TCP listening was disabled; the private Unix socket/data directories were restricted. No application was started and no email delivery was enabled. The cluster was stopped after verification.

- All 10 migration checksums matched the reviewed SQL. Schema comparison with a clean, equivalently dump/restored migration reference matched 220 columns, 282 constraints, 95 indexes, 30 enabled triggers, 19 SECURITY INVOKER functions and 84 enum labels. Foreign keys were validated.
- All 27 table counts matched the source snapshot, including two organizations, two users, four invitations, two memberships, one proposal/project and two completion receipts.
- Restored checks verified exact item arithmetic and the 125000-centavo revised agreement, accepted current milestone/deliverable records, owner implementation and checklist completion, both closure snapshots and the intervening reopening audit.
- Invitation/account/membership checks found no duplicate identities/pairs or consumed-and-revoked invitation. The revoked unconsumed link, consumed replacement, prior membership revocation and same-client reactivation audit were consistent. Current active memberships in both organizations were preserved.

This demonstrates recovery of this populated snapshot, not a disaster-recovery SLA, ongoing backup retention or a hosted recovery deployment. `--no-owner --no-acl` was intentional: Neon roles, object ownership and runtime ACL recovery were not reproduced. Restored sessions were not exercised or exposed; session invalidation/secret rotation and explicit grants remain requirements before any separately authorized recovery could serve traffic. See the [staging runbook](staging.md) and [runtime-role/grant verification](staging-runtime-role.md).

## Availability incident and remaining gaps

Before the recovery redeployment, bodyless health requests repeatedly timed out even though deployment metadata said live. DNS/TCP and verified TLS succeeded in some probes, while HTTP headers never arrived; another probe stalled during TLS. Chrome was also affected. One accepted restart did not restore health. Instance listings were empty, metrics returned empty series, and current logs were absent; an earlier log retrieval returned a Loki-related 503. Missing telemetry was not treated as proof of normal runtime behavior.

The exact compiled release passed local production-mode health/static/anonymous API checks. With a disposable stalled local database connection, health/static still returned 200 while a database-dependent CSRF request eventually returned a safe 500. This did not reproduce database waits blocking health. Render's public status page reported no incident at the time; that did not rule out a service-specific failure.

A single same-SHA cached redeployment restored observed HTTP availability. **The outage cause remains unresolved.** Recovery alone does not prove a Render-wide incident, normal cold start, database failure or application defect. Scheduler/process existence, upstream routing/request traces and reliable telemetry during the failure remain missing evidence.

Unverified or deferred:

- Isolation between two distinct client identities; the hosted A/B journey used one client identity. Revoked-member direct API denial remains a separate hosted gap.
- Hosted delayed-session-save/logout race, concurrent mutations and race/rollback scenarios. Local tests do not substitute for hosted execution.
- Other completed-state write endpoints, new pending decisions after completion, full browser UI write prevention, concurrent requests, stale-editor recovery, mobile/keyboard and all error states in this hosted journey.
- Ownership/ACL/role recovery, recovery-session invalidation, production restore deployment, retention/deletion policy and operational recovery guarantees.
- Root cause and long-term resolution of the availability incident; successful bounded checks do not establish an uptime guarantee.
- Production email readiness beyond one allowlisted inbox, delivery webhooks/durable outbox, private uploads/storage, recovery/MFA, billing and AI. The original full MVP remains incomplete.

Historical [M2](../product/m2-checkpoint.md) and [M3](../product/m3-checkpoint.md) checkpoints describe earlier local evidence and gates; this document updates the specifically observed staging scope without retroactively claiming those earlier branches ran hosted tests. CI for this documentation branch is pending until separately pushed and executed.
