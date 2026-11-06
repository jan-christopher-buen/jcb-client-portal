# ADR-003: Immutable proposal versions and atomic approvals

Status: implemented for the proposal M2 slice. Project lifecycle and milestones now extend this in [ADR-004](004-project-milestones.md); proposal invariants remain in force. Authentication and invitation decisions in ADR-002 remain in force. No milestone, billing, file, AI or deployment scope is added.

## Records and boundaries

A proposal belongs to one organization and has a current published-version pointer. Each version contains its title, scope, exclusions, delivery assumptions, private owner notes, PHP currency, ordered items and authoritative total. A draft is editable; publishing freezes its snapshot. Version states are DRAFT, SENT, SUPERSEDED, APPROVED and DECLINED.

Items are an ordered JSONB array within the version, rather than independent mutable item records. This keeps a sent snapshot and its item order together. Server validation and a SQL check function validate every item and the aggregate. A database update trigger prevents changes to published snapshot content, items, totals, identities, publication timestamps and edit revisions; only permitted state transitions remain possible. The API provides no version/history deletion operation.

There is at most one draft and one SENT version per proposal, enforced by partial unique indexes. A composite foreign key makes the published pointer reference a version of this exact proposal and organization. Decisions are unique per version and record the real client actor, outcome and UTC timestamp. Receipt updates are rejected by a database trigger.

Projects have unique proposal and approved-version references. Composite foreign keys ensure project, proposal, snapshot and organization agree; another foreign key requires a decision for the approved version. A database trigger rejects project creation unless that version and decision are APPROVED. Project status is PLANNED only in this slice. Project scope is read from the immutable approved version, without a mutable copy.

## Exact money contract

| Value                 | Bound / representation                                           |
| --------------------- | ---------------------------------------------------------------- |
| Currency              | PHP only                                                         |
| Ordered items         | 1–100                                                            |
| Quantity              | Integer 1–10,000                                                 |
| Unit price            | Canonical decimal-string centavos, 0–1,000,000,000,000 inclusive |
| Proposal total        | 0–100,000,000,000,000,000 centavos inclusive                     |
| Versions per proposal | 1–100                                                            |

The server parses all input with strict Zod schemas and calculates totals using BigInt. It does not accept a submitted total. SQL uses bigint/numeric to independently check bounds and exact item sums. All money is serialized as decimal strings, including values above JavaScript's safe Number range. Explicit zero-price items are supported. No taxes, discounts, fractional quantities, deposits or installments are implemented.

The editor accepts decimal PHP text and converts whole/fractional strings to centavos with BigInt; it never parses prices as floating-point numbers. Saved totals come from the server. Display formatting also uses BigInt. Quantity is a separately bounded integer.

## Transaction and concurrency policy

Installed Prisma CLI/client/adapter remain **7.10.1**. Its [v7 transaction API](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions) and [compound relations](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/relations/one-to-one-relations) were reviewed before implementation; no dependency upgrade was required.

Writes use short serializable interactive transactions. Lock order is organization → current enabled user/membership → proposal. User/membership share locks force a fresh transaction if disable/revocation committed while the request waited. Proposal writes advance a lock revision so competing transactions retry from a fresh snapshot. No network/mail operation occurs inside these business transactions.

Retry only serialization/deadlock errors: Prisma P2034, or raw-query P2010 with PostgreSQL SQLSTATE 40001/40P01. Prisma 7's pg adapter can expose the SQLSTATE under `meta.driverAdapterError.cause.originalCode`; real overlapping tests exposed and verified this path. There are at most four transaction attempts, then a safe 409 RETRY_REQUIRED. Validation, permission, stale-version and ordinary database failures are not blindly retried.

Draft saves require the displayed edit revision, preventing silent last-write-wins edits. Sending requires the saved revision the owner reviewed. Repeated sending of the same current SENT version returns the existing result. Publishing a replacement transitions the previous SENT snapshot to SUPERSEDED, publishes the draft, moves the pointer, and records history atomically. A previously DECLINED receipt remains declined in history.

Creating a revision only copies a published version into a new draft; it does not move the published pointer. Approved proposals cannot create, edit or send revisions. If approval wins while a revision draft already exists, that draft is retained owner-only and frozen by the proposal's approved state.

A client decision transaction validates active membership and every nested relation, confirms the current pointer, conditionally changes SENT to the outcome, inserts the unique receipt, creates the planned project only for approval, and appends decision/project activity before commit. Any failure rolls everything back. Approval versus superseding yields either the old approved snapshot/project or the new SENT version, never a mixed outcome.

A repeated identical decision on the current version returns the original receipt and project ID, preserving its original actor and time even if another active member retries. A conflicting outcome returns 409. A decision against any noncurrent version returns STALE_VERSION, including retries against an older declined version after a replacement was published. The owner cannot decide for a client.

## Authorization and interface

All endpoints remain behind server-side sessions, Origin and synchronizer-CSRF controls. Clients receive only their organization's published versions and approved projects; drafts and owner notes are omitted from every client DTO. Inaccessible records return 404. Reads and writes recheck active membership; IDs and hidden controls do not authorize access.

Routes are nested under `/api/organizations/:orgId`: proposal list/create/detail; revision creation; version edit/send/decision; project list/detail. Organization, proposal, version and project IDs are validated together. Lists use twenty-row pages. A proposal detail returns up to its bounded one hundred versions.

Owner screens support explicit draft save/review/publish, ordered item editing, revision creation and history. Client screens show current versus historical snapshots, decision receipts and planned-project links. Forms retain input after failures; pending-action guards limit duplicate clicks while server idempotency handles retries. Unsaved editor changes warn on link navigation or page unload; browser-history navigation is not intercepted. Activity is owner-readable and contains enumerated kinds and safe identifiers, not credentials or arbitrary metadata.

The test runner serializes integration files because the database deliberately permits only one owner. Workflow race tests still use separate Prisma adapters, API servers and physical connections; a fixture-only coordination lock confirms both requests overlap. Failure-injection triggers are restricted to a generated test version, removed afterward, and verify both full rollback and bounded retry exhaustion. Only generated fixtures are cleaned; no reset/truncate command is used.

## Remaining limits

Publishing means sharing inside the portal, not sending email. Approval is a recorded workflow decision, not a claimed electronic-signature service. Milestones, scheduling, change requests, payments, uploads and project status transitions remain deferred. Hosting, production email/recovery/MFA and operational readiness are unchanged pending gates. Local checks do not constitute remote CI or production verification.
