# jcb client portal

A client portal for freelance web development and SEO engagements, bringing client organizations and invitation-only access into a shared workspace. Versioned proposals, project status, and milestone review rounds build on that access foundation. Versioned change offers record client-approved scope adjustments. Versioned deliverables support text, external links and client acceptance. Handover checklists and a guarded completion gate record workflow closure; private uploads remain future work.

**Current scope: M1–M2 core workflows and local M3 change-request, deliverable-review and handover slices.** Owners can manage organizations and business contacts, issue invitations, and revoke client memberships. Invited clients can create an account or sign in with an existing account and access only their active organizations. Owners can draft and publish versioned PHP proposals; active clients can approve or decline, with approvals atomically creating one planned project. Owners can activate/hold/resume/cancel projects and submit text-only milestones; clients can request changes or accept numbered review rounds. Clients can request scope changes; owners clarify/publish offers and record implementation after client approval. Owners publish deliverable snapshots; clients request changes or accept a specific version. Owners manage handover checklists and explicitly complete ready projects, with reasoned reopening and immutable closure snapshots. This is not the complete portal or a production release.

## Stack and architecture

React + strict TypeScript + Vite + React Router + CSS modules; Node 24 + Express; PostgreSQL + Prisma 7; Passport local + Argon2id; PostgreSQL-backed sessions; Zod validation; Nodemailer SMTP to a local mail sink.

- `apps/web`: sign-in, invitation onboarding, owner/client organization, proposal editor/review, project lifecycle, milestone review, versioned change-request, deliverable-review and handover screens
- `apps/api`: authentication, scoped organization resources, invitation, proposal, milestone review, change-approval, deliverable-review and guarded completion transactions
- `packages/contracts`: shared input schemas and DTOs; no browser ORM models
- `prisma`: additive migrations and session/business constraints
- `docs`: [authentication architecture](docs/architecture/002-authentication-and-invitations.md), [proposal architecture](docs/architecture/003-proposal-approval.md), [project/milestone architecture](docs/architecture/004-project-milestones.md), [change-request architecture](docs/architecture/005-change-requests.md), and [implemented change-request slice](docs/product/change-request-slice.md)

Production builds serve browser assets and `/api` from one Express origin. Development uses the Vite API proxy. Lowercase `jcb.` branding uses system font fallbacks until licensed local font files are available.

## Local setup

Requires Node **24.22.2** (nvm is supported) and a running local PostgreSQL server. No cloud service or paid account is required. Use fictional data.

```bash
nvm install
nvm use
npm ci
cp .env.example .env
createdb jcb_portal_dev
createdb jcb_portal_test
```

Skip `createdb` for databases that already exist. Edit `.env` with your local database credentials and a random session secret of at least 32 characters. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Never commit `.env`.

| Environment name    | Purpose                                                   |
| ------------------- | --------------------------------------------------------- |
| `NODE_ENV`          | `development`, `test`, or `production`                    |
| `PORT`              | API port, defaults to 3000                                |
| `APP_ORIGIN`        | Exact browser origin; use `http://localhost:5173` locally |
| `DATABASE_URL`      | Loopback PostgreSQL URL for `jcb_portal_dev`              |
| `TEST_DATABASE_URL` | Separate loopback PostgreSQL URL for `jcb_portal_test`    |
| `SESSION_SECRET`    | Random secret of at least 32 characters                   |
| `SMTP_HOST`         | Loopback SMTP host; default `127.0.0.1`                   |
| `SMTP_PORT`         | Local mail sink SMTP port; default 1025                   |

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run owner:create -- --email owner@example.test --name "Local owner"
```

`owner:create` prompts for a hidden password of 12–128 characters. It also supports password input through stdin. It refuses an existing owner or email and never upgrades an existing account. There is no public owner registration. Use your chosen local owner email in place of the example. The seed command only checks connectivity; it creates no users or fixtures.

In separate terminals, start:

```bash
npm run mail:dev
```

```bash
npm run dev
```

Open **http://localhost:5173**, sign in as the provisioned owner, create an organization, and send an invitation. Read it at **http://127.0.0.1:8025**. The sink listens on loopback SMTP port 1025 and keeps up to fifty messages in memory. It sends no external email; restarting clears the inbox. Keep the API on port 3000 when using the default Vite proxy. Stop both commands with Ctrl+C.

## Invitation and access behavior

- New clients open their emailed link, enter a name and password, and accept. The server derives their email from the invitation, then creates a CLIENT account and membership atomically.
- Existing users sign in with the invited email before accepting. Another signed-in email cannot accept it. Contacts alone never grant access.
- Invitations expire after 72 hours and are single-use. Reissuing revokes earlier unused links for that organization/email. Delivery failure is shown explicitly; fix the local sink and reissue.
- Links contain a token in their fragment. The portal removes it from the address bar and keeps it only in memory. After refreshing the invitation page, reopen the email link.
- Only token hashes are stored in business tables. Normal API responses and portal screens do not expose invitation tokens. The local inbox displays the actual email for development.
- Session IDs and CSRF tokens rotate on login. Logout destroys the session. Authentication expires after eight hours; disabled users and revoked memberships are checked on subsequent requests.
- Every mutation requires an exact allowed Origin and session-bound CSRF token. Login is limited to ten attempts per IP per fifteen minutes; invitation operations have separate limits.
- Clients receive only their active organizations, without owner discovery notes, contacts, or access administration. Archiving an organization removes client access until restored. Revoked memberships remain revoked after restoration.
- Invitation and membership events record actor, time and target without passwords, tokens, or session secrets.

## Proposals and planned projects

Open an organization, then **Proposals and projects**. Owners create drafts with title, scope, exclusions, delivery assumptions, private notes, and ordered line items. Save the draft to obtain the server-calculated total; review it, then explicitly send/publish it. Publishing shares it in the portal and does not send email.

Only PHP is supported. Prices accept decimal PHP text; the API stores/serializes whole-centavo values as strings and calculates totals with BigInt. Explicit zero-price items are allowed. Quantities are integers from 1 to 10,000, with 1–100 items, maximum unit price PHP 10,000,000,000.00 and maximum total PHP 1,000,000,000,000,000.00. Taxes, discounts and fractional quantities are not implemented.

Sent snapshots and their ordered items are immutable. Creating a revision draft leaves the current published version available; publishing the replacement supersedes the old undecided version. Drafts and private notes are never included in client responses. Each proposal is limited to 100 versions.

Active client members may approve or decline the current sent version. The owner cannot act for the client. Approval records the real actor/version/time, creates exactly one planned project, and appends history in one transaction. Decline creates no project. Identical retries return the original result; conflicting or stale decisions return a clear conflict. Approved proposals are locked. If approval wins while a revision draft exists, that draft stays private and cannot be edited/published.

Projects start **planned** and display the actual approved scope and cost breakdown. Owners can move Planned → Active → In review; hold/cancellation require a reason. Resume restores the pre-hold state, while cancellation is terminal. Completion is owner-confirmed through the handover readiness gate described below. Approval is a recorded workflow decision, not a claimed legally binding electronic-signature service.

Milestones move Planned → In progress → In review → Accepted. Requesting changes requires feedback and returns work to In progress. Every submission creates an immutable numbered text snapshot. Withdrawal/reopening require reasons and retain earlier rounds and acceptance. Held/cancelled projects reject workflow writes. Progress counts accepted required milestones; no required milestones displays “No required milestones yet”. Due dates use Asia/Manila, with overdue starting the following day and excluding accepted milestones/cancelled projects. Workflow history records real actors and UTC timestamps.

Scope changes preserve the approved proposal. Active clients create requests and respond to clarification; owners keep private notes and publish immutable numbered offers. Clients approve/decline only the current offer. Original amount, approved adjustments and revised agreed amount display separately, using exact signed centavos. Approval is coordinated across requests on the same project and cannot make the revised amount negative or exceed the supported maximum. Implementation is an owner record with a note, not client acceptance or project completion. Schedule impact is descriptive; approval never shifts milestone dates.

## Deliverables and client acceptance

Owners create deliverables in a project overview, save private drafts, then explicitly publish immutable numbered versions. Content is plain text with up to five labeled HTTPS DNS links. A revision draft leaves the current version and acceptance intact. Publishing supersedes it and requires a fresh client decision. Replacing an accepted version requires a reason. Owners may withdraw only an undecided current version, with a reason. Previous versions, feedback and receipts remain readable; there is no history-deletion endpoint.

Only current active client members can accept or request changes; changes require feedback. Owners cannot decide for clients. Decisions, replacement, withdrawal and history use the same project coordination as hold/cancellation and membership changes. Held/cancelled projects remain readable but reject workflow writes. Required-flag changes are audited. Deliverable acceptance alone does not complete a project or replace milestone review.

Links are untrusted external destinations. Their provider controls access; portal authorization does not make linked files private, and HTTPS does not guarantee safe content. Validation rejects credentials, local names, malformed URLs and all IP literals (including public IPs). The portal performs no DNS resolution, URL fetching, preview or redirect inspection; an accepted DNS destination can change or redirect. Links open in a new tab with opener/referrer protections. Use public fictional resources for demos. Private storage and uploads remain excluded. See [deliverable architecture](docs/architecture/006-deliverable-reviews.md) and [slice behavior](docs/product/deliverable-slice.md).

## Handover and guarded workflow closure

Open **Handover and completion readiness** from project overview. Owners manage ordered, required/optional checklist tasks, explicitly mark or uncheck them with reasons, and can keep tasks owner-only. Clients can read visible tasks and their completion actor/time but cannot edit them. Do not store passwords, tokens or secrets in task text. Editing a task clears its completion and preserves before/after history. Required-flag changes on milestones, deliverables and checklist items require an explicit recorded reason.

Completion requires In review status, at least one required milestone, deliverable and checklist task, all required current milestone rounds/deliverable versions accepted, all required checklist tasks complete, every approved change implemented, and no unresolved requests or offer drafts. The readiness endpoint evaluates all authoritative records, independently of display pages. The owner explicitly confirms; one transaction rechecks readiness, records actor/time, saves an immutable cycle snapshot referencing review/acceptance/checklist/change state, changes status and appends activity. Earlier displayed readiness cannot authorize completion. Duplicate confirmations return the existing record.

Change requests resolve through implementation, a clean decline (no draft), or explicit owner closure with a reason. OPEN, NEEDS_CLARIFICATION, OFFERED, APPROVED-unimplemented and unfinished drafts block closure. Closing an unapproved request abandons its unpublished drafts and supersedes pending offers; history remains. A draft frozen by earlier offer approval must also be explicitly abandoned before project completion. Abandoned drafts remain owner-only and cannot be revived; approved offers and amounts remain unchanged.

Completed projects retain authorized read access and reject workflow changes. The owner can explicitly reopen to In review with a reason, preserving earlier closure snapshots. A later completion requires a fresh gate check. The project lock coordinates completion against milestone reopening, deliverable replacement/withdrawal, required flags, changes/offers, checklist actions and project status. Private checklist content stays out of client readiness, activity and snapshots.

Completion records workflow closure, not payment, legal certification or independent verification of external links. See [handover architecture](docs/architecture/007-project-handover.md) and [implemented behavior](docs/product/handover-slice.md).

For an existing local checkout, apply the additive migrations without resetting data:

```bash
nvm use
npm run db:generate
npm run db:migrate
```

Existing owner/client accounts and memberships are retained. Stop/restart development servers after migrating; start the mail sink only when testing invitations.

## Opt-in local demonstration

The [local demo walkthrough](docs/product/local-demo.md) explains separate owner/client sign-in, runtime credentials, key screens and one complete transaction. `demo:seed` requires explicit development/demo configuration and an empty loopback `jcb_portal_demo` database. It applies additive migrations, creates fictional active/completed projects through normal business services and writes generated credentials to a new private file outside the checkout. It never replaces existing data and never runs during normal startup or `db:seed`. `demo:dev` binds API/Vite locally and generates an ephemeral session secret. There is no public demo login or authorization bypass.

See the [M3 checkpoint and release checklist](docs/product/m3-checkpoint.md) for local evidence, pending remote CI, deployment/operational gates and deferred product scope. **The original full MVP is not complete while private uploads/storage and other release requirements remain deferred.**

## Checks and scripts

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
```

Integration tests use the dedicated `TEST_DATABASE_URL`, apply additive migrations, and clean up only their generated fixtures. They reject remote hosts, development database names, and matching development/test names. They do not reset a database. Integration files run sequentially to respect the single-owner constraint; proposal race tests use separate database pools and deliberately overlapping requests. Generated failure triggers verify transaction rollback and retry exhaustion. Workflow races cover client decisions versus withdrawal/reopening/hold/cancellation and membership revocation while waiting. The suite starts an ephemeral local SMTP sink. Keep the test database reserved for automated checks; it must not contain a manually provisioned owner.

Other commands: `npm run format` applies formatting; `npm run db:migrate` deploys checked-in migrations to the local development database; `npm start` serves the compiled app and API after `npm run build`. For a local single-origin check, use `APP_ORIGIN=http://localhost:3000` and stop Vite/API development servers first.

GitHub Actions supplies PostgreSQL and runs formatting, lint, types, smoke/integration tests and build. A remote workflow run requires pushing the branch separately.

## M2 integration checkpoint

The complete local owner → invitation → client onboarding → proposal approval → project → milestone review journey is implemented and reviewed. See the [checkpoint](docs/product/m2-checkpoint.md) for integration fixes, migration validation, current limits and the next milestone. Local validation covers a clean lockfile install, formatting/lint/types, unit/integration tests, a production build and compiled-server checks; earlier full browser verification is retained. The merged M3 change-request base passed [remote Checks](https://github.com/jan-christopher-buen/jcb-client-portal/actions/runs/42222947067). That run does not verify this checkpoint branch; remote CI remains pending until pushed, and deployment remains unverified.

Normal development/test database commands require plain loopback URLs with their exact database names; query parameters and fragments are rejected so connection options cannot override safety checks. Use dedicated disposable test data. No reset command is supplied.

## Limitations

Private uploads/storage, billing/payment collection, AI, external email delivery, password recovery, MFA, and public signup are not implemented. Owner detail sections show up to 100 records; organization lists have 20-row pages. Projects support 100 milestones and 100 rounds per milestone, unique display-order slots 1–100, and 50 workflow events per page. There is no milestone deletion or order-slot swapping. Due-state displays refresh on reload. Change requests are capped at 100 per project, with 100 offer versions and 100 discussion entries each; lists use 20-row pages. Signed adjustments are bounded to ±100,000,000,000,000,000 centavos; revised agreements must remain 0–100,000,000,000,000,000 centavos. Deliverables are capped at 100 per project, 100 versions each, five links per version (1,000 characters per URL), and 50 activity entries per page. Display order uses unique slots 1–100; there is no automatic slot swapping. Handover supports 100 tasks with unique order slots 1–100 and 50 activity events per page. Completion snapshots remain available after reopening; readiness never uses paginated histories. There are no automatic schedule changes. SMTP delivery has no durable outbox or automatic retry; a crash can require reissuing an invitation. Login limits are shared by users behind the same IP. Proposal/offer/deliverable editor guards cover in-app links/navigation and Back/Forward; supported browsers warn on refresh/tab close. Forced browser exits, crashes, mobile termination and session expiry cannot be guaranteed to preserve unsaved memory.

Production invitation delivery is disabled. Hosting, budget, HTTPS and exact proxy trust, backup/restore, retention, and production abuse controls remain deployment gates. No staging deployment or public demo is available, and no production readiness is claimed.
