# ADR-004: Project lifecycle and immutable milestone review rounds

Later extension: [ADR-007](007-project-handover.md) adds guarded completion/reopening, auditable required flags and explicit change-request/draft resolution. Its rules supersede earlier deferred-completion descriptions below.

Status: implemented for the final core local M2 slice. ADR-002's security controls and ADR-003's proposal/approval invariants remain in force. This supersedes their deferred project-status/milestone descriptions, without adding completion or handover.

## States and records

Project transitions are PLANNED → ACTIVE → IN_REVIEW. Owner-only HOLD and CANCEL actions require a trimmed, bounded reason. Holding records the previous working state in `resume_status`; RESUME restores exactly that state and clears the pointer. Cancellation is terminal. There is no COMPLETED enum, API action, button or automatic completion when all required milestones are accepted. Completion depends on a future handover gate.

Every workflow mutation locks and advances the project's revision. Owner project-status commands require the revision the owner reviewed; stale forms return 409. Read access is available on held/cancelled projects, but milestone creation/edit/start/submit/withdraw/reopen and client decisions are blocked. A held project may resume or be cancelled. A cancelled project cannot resume. Archiving the organization retains its existing stronger client-access restriction.

A milestone has a title (1–120), text description (1–12,000), optional PostgreSQL DATE due date (1900–9999), required flag and unique project/display order (1–100). Projects support at most 100 milestones. Order values are stable explicit slots; changing one requires an unused slot. There is no implicit renumbering or deletion endpoint. Edits require the current milestone revision and are permitted only in PLANNED or IN_PROGRESS.

Milestone transitions are PLANNED → IN_PROGRESS → IN_REVIEW → ACCEPTED. Submission creates a numbered (1–100) review round containing the title/description snapshot, submitting owner and UTC timestamp. A pending round is unique per milestone. Clients accept or request changes with required feedback; changes return the milestone to IN_PROGRESS. Accepted rounds can carry optional feedback.

To revise an IN_REVIEW milestone, the owner must withdraw its current pending round with a reason. Withdrawal records its actor/time/reason, clears the current-round pointer and returns the milestone to IN_PROGRESS. Reopening an accepted milestone requires a reason, preserves the earlier ACCEPTED receipt, clears the pointer and returns it to IN_PROGRESS. Resubmission always creates a new number. No owner action can accept for the client.

Database composite foreign keys validate organization/project/milestone and current-round/milestone relations. SQL checks enforce metadata/date bounds and valid pending/decision/withdrawal receipt shapes. Triggers prevent changes to submitted content or terminal receipts, edits to IN_REVIEW/ACCEPTED milestone metadata, identity changes and workflow-history updates. Conditional writes and the service enforce transitions, current-round/client authorization and reasons. These are application-managed writes; unrestricted database operators are outside the authorization boundary.

## Atomicity and access

Installed Prisma CLI/client/adapter stay at 7.10.1; the [v7 transaction documentation](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions) was reviewed. The current unversioned documentation describes Prisma 8, so this implementation reuses the established v7 interactive transaction API rather than migrating dependencies.

Lock order remains organization → enabled user/current membership → project. A project lock plus revision write serializes all its milestone and status changes; waiting serializable transactions retry with a fresh snapshot. The existing maximum four attempts and P2034/P2010 SQLSTATE 40001/40P01 handling are reused. No network or mail operation runs inside a transaction. A failed history/activity insert rolls back the milestone state, round receipt and project revision together.

Decision requests identify the full organization/project/milestone/review path. They recheck the current round, current active membership and enabled identity. Identical outcome plus normalized feedback on the current round returns its original timestamp/result. A different outcome or feedback conflicts. Withdrawn rounds, rounds replaced by resubmission, and old acceptances after reopen are stale (409), even if their decision previously succeeded. Held/cancelled projects reject retries until resume where applicable. Owner actions use milestone revisions, preventing stale withdrawal/reopen/edit/submission commands.

Concurrent decision versus withdrawal leaves exactly one terminal round outcome. Concurrent decision versus hold/cancel either commits the decision first and rejects the owner's stale status command, or pauses the project first and rejects the decision. The owner can reload and intentionally hold/cancel afterward. Retried acceptance versus reopen either returns the earlier receipt before reopening or gets a stale conflict afterward; the prior receipt is preserved in either ordering.

All routes retain sessions, Origin and CSRF. Clients may read only their current active organizations. Direct path swaps return 404; browser controls do not establish authorization. Workflow reads use one repeatable-read snapshot across authorization, project, milestones, progress and history. DTOs explicitly select safe business fields and never include internal proposal or discovery notes. Existing approved-scope DTOs continue to omit notes for clients.

## Progress, dates and history

Progress is accepted required milestones / all required milestones. Optional milestones do not contribute. An empty denominator displays “No required milestones yet”, with no synthetic percentage. Reopening immediately removes that milestone from the numerator.

Date-only values round-trip as YYYY-MM-DD, stored as SQL DATE through UTC-midnight adapter values. Overdue is evaluated by the server against today's Asia/Manila calendar date; it starts the following local day and excludes ACCEPTED milestones and CANCELLED projects (the helper also excludes future COMPLETED). Hold does not erase overdue. All event timestamps are timestamptz/UTC and display in Asia/Manila. Open screens refresh the derived value when reloaded, not on a background midnight timer.

Client-safe workflow events contain kind, actor, previous/next state, bounded reason and UTC time, linked by composite keys to the correct project/milestone. A matching existing activity event contains only the enumerated kind and safe event ID. Feedback lives in its immutable review receipt, never arbitrary log metadata. History pages contain 50 events, with previous/next controls; milestones/rounds are bounded to 100 each. Only the generated fixtures are removed by tests; there is no reset or truncate command.

## Browser interaction

Owner/client project overviews expose current status, next action, real progress, due dates/overdue, milestone links, approved scope and activity. Review screens show every round, exact submitted text, feedback, actor/time and withdrawal reasons. Pending-action refs prevent duplicate clicks; server idempotency remains authoritative. Failed saves/decisions retain input, with an explicit reload option for stale state. Text descriptions render as text, never uploads or public file links.

The installed React Router 8.5.1 [useBlocker API](https://reactrouter.com/api/hooks/useBlocker) requires a data router. The root now uses `createBrowserRouter`/`RouterProvider`, retaining existing page routes. The proposal editor blocks links, programmatic in-app navigation and Back/Forward with an inline keep/discard choice; successful saves bypass the blocker. A `beforeunload` handler requests a native tab-close/refresh warning where supported. No claim is made that mobile termination, browser crashes, logout/session expiry, or every browser exit can be intercepted. Drafts are retained after failed saves in component memory, not persisted across a forced exit or reload.

## Verification and limits

Integration races use independent Prisma adapters/API servers and a coordinating connection that verifies both requests wait on the organization lock before release. Tests cover decisions versus decisions/withdrawal/hold/cancellation/reopen, membership revocation while waiting, snapshot immutability, stale revisions, scoped nested IDs, reasons/feedback, progress and activity-failure rollback. Unit tests cover Manila midnight and calendar validation. Browser verification is local; no remote CI, hosting or production release is implied.

Text-only submissions, stable unused order slots and bounded histories are deliberate limits. Change requests, files, handover/completion, billing, AI, external email, password recovery/MFA and deployment remain excluded. The full product and operational release gates remain unfinished.
