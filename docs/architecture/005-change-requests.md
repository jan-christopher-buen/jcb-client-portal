# ADR-005: Versioned change offers and agreed-scope adjustments

Later extension: [ADR-007](007-project-handover.md) adds guarded completion/reopening, auditable required flags and explicit change-request/draft resolution. Its rules supersede earlier deferred-completion descriptions below.

Status: implemented for the first local M3 slice. Existing authentication, proposal snapshots, project/milestone states and release gates remain in force. This adds no files, billing, completion or deployment.

## Records and lifecycle

Active client members create a project change request with title (1–120), requested change (1–8,000) and business context (1–4,000). The original request is immutable. Organization/project composite foreign keys and scoped queries validate the complete ownership path.

Request states are OPEN, NEEDS_CLARIFICATION, OFFERED, APPROVED, DECLINED and IMPLEMENTED. Before a pending offer exists, the owner may request clarification from OPEN/NEEDS_CLARIFICATION/DECLINED; an active client member responds to NEEDS_CLARIFICATION, returning it to OPEN. Messages are append-only, carry actor/time and have a 4,000-character bound. OWNER_NOTE messages are owner-only and do not create public activity events. Clients never receive these rows, offer drafts or proposal/discovery notes. Owner notes may also be appended after approval/implementation without changing agreed content.

Only the owner prepares offer drafts. Each version has offered scope (1–8,000), exclusions (up to 4,000), signed PHP centavos and required descriptive schedule impact (1–2,000). New drafts copy the current published offer, or use the requested change with zero adjustment/no schedule impact as editable initial content. The owner explicitly reviews, saves and publishes. Creating/saving a draft preserves the current published offer. Publishing atomically supersedes the previous PUBLISHED offer, publishes the replacement and moves the pointer. A pending clarification response blocks publication. Declined receipts stay in history when a replacement is published.

Offer states are DRAFT, PUBLISHED, SUPERSEDED, APPROVED and DECLINED. Partial unique indexes permit one draft, one pending and one approved offer per request. A composite foreign key makes the current pointer reference this exact request's offer. Database triggers protect sent snapshot content/identity, terminal states, original request content, discussion entries and decision receipts. An already-created draft freezes if another session approves the current offer.

Only an active project client may decide the current PUBLISHED offer. Approval/decline records version, real actor, outcome and UTC timestamp in a unique receipt. An identical retry returns that receipt plus current project amounts; a conflicting outcome returns 409. Noncurrent versions return STALE_OFFER, including older declined receipts after replacement. The owner cannot decide on the client's behalf. Approved requests/offers cannot be revised or superseded; further scope requires a new request.

Owner-only implementation requires an approved request, current request revision and a nonempty client-visible implementation note (up to 2,000). Actor/time/note are preserved; repeat implementation conflicts. IMPLEMENTED records work by the owner, not client acceptance, milestone acceptance or project completion. The approved offer remains the agreed snapshot and keeps contributing to amounts.

## Precise agreement amounts

All input/output money uses canonical integer-centavo strings. Adjustments allow positive, zero and negative values, bounded to ±100,000,000,000,000,000 centavos (±PHP 1,000,000,000,000,000.00). Revised agreed amounts must remain between zero and the same maximum. API schemas reject numbers, decimals, exponent notation, leading zeros, `+` prefixes and negative zero. Editor decimal text converts via BigInt, never floating-point arithmetic.

The authoritative amounts are derived from the original approved proposal plus uniquely approved offer decisions. There is no separate mutable total or duplicate adjustment ledger to drift. The API serializes original amount, sum of approved adjustments, revised agreed amount and individual approved versions separately. Pending, draft, superseded and declined offers do not count. Implemented offers continue to count exactly once. The original proposal is never rewritten. Aggregation uses BigInt in the service and numeric in the SQL guard, avoiding aggregate bigint overflow and JavaScript Number precision loss.

An offer may be published while its adjustment would currently exceed the aggregate bounds; clients can read/decline it, but approval returns a useful AGREED_AMOUNT_BOUNDS conflict until a valid replacement or other approved adjustments make it possible. This is an agreed-scope mechanism, not an invoice, refund, tax or payment system.

Schedule impact is descriptive only. Approval does not alter project status, milestone dates, milestones' required flags, progress or client acceptances. Date changes require a separate owner action under the existing milestone-edit/withdraw/reopen rules.

## Transactions and authorization

Prisma CLI/client/adapter remain pinned to 7.10.1; its [v7 transaction API](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions) was checked and existing APIs/dependencies reused. Change writes use the existing serializable project transaction with at most four attempts for P2034 or adapter P2010 SQLSTATE 40001/40P01 conflicts. No external/network/mail work runs inside transactions.

Lock order is organization → current enabled identity/membership → project. Every change mutation advances the same project revision used by milestone/status operations. This serializes approvals across DIFFERENT requests and coordinates approval with hold/cancellation, replacement and membership revocation. Approval re-reads all committed approved adjustments, validates the revised total, conditionally changes PUBLISHED, inserts the unique receipt, updates request state and appends safe activity before commit. The SQL decision guard also checks the current version, client/membership, working project state and aggregate bounds. Any failure rolls back the receipt, totals' inputs, request/offer state, project revision and activity together.

Held/cancelled projects preserve normal authorized reads but reject all workflow writes, including creation, discussion/notes, drafts, decisions/retries and implementation. A held project must resume; cancellation remains terminal. If approval wins a race, an owner's previously displayed status revision conflicts; the owner may reload and intentionally hold/cancel afterward. Disabled/revoked users cannot authorize waiting writes after the locking recheck. Read DTOs use a repeatable snapshot across authorization, request/offers/history and project amounts.

Endpoints nest under `/api/organizations/:orgId/projects/:projectId/changes`: list/create, detail, messages, draft creation, draft edit, publish, decision and implementation. Every request/offer path is revalidated with its parent. Sessions, allowed Origin and CSRF remain mandatory; unpredictable IDs and hidden controls do not establish permission. Activity contains enumerated change kind, actor/organization/target IDs and UTC time; no secrets or note text are logged.

## Interface, bounds and verification

Project overviews link to request lists and show original/adjustment/revised amounts independently from original approved scope. Owner/client detail screens show discussion, explicit current/historical offer labels, decision receipts, schedule policy and owner implementation notes. Owner-only editors retain input after failure and guard unsaved in-app navigation/browser unload where supported. Pending refs prevent duplicate clicks; server checks remain authoritative. Reloading stale state is explicit. No browser exit or forced termination is guaranteed to preserve unsaved memory.

Projects support 100 requests, each with 100 versions and 100 discussion entries (including owner notes). Lists have twenty-row pages; individual histories are bounded and returned together. There are no request deletion, shared general comments, per-message editing or order/date automation features.

Dedicated guarded database tests use independent adapters/API servers and a coordinator proving overlapping lock waits. They cover signed totals, aggregate underflow/overflow across requests, private drafts/notes, nested isolation, immutable snapshots, clarification/decline/replacement, original scope/dates, implementation, duplicate/conflicting decisions, publication/status/revocation races and injected-failure rollback. Local browser journeys verify the connected workflow, negative adjustments, stale-submit and failed-save recovery, mobile layout and keyboard access. Local checks do not establish remote CI or production readiness.
