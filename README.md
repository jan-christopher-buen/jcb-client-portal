# jcb client portal

A client portal for freelance web development and SEO engagements, bringing client organizations and invitation-only access into a shared workspace. Versioned proposals, project status, and milestone review rounds build on that access foundation. Handover and project completion remain future work.

**Current scope: core M2 access, proposals, project lifecycle, and milestone reviews in local development.** Owners can manage organizations and business contacts, issue invitations, and revoke client memberships. Invited clients can create an account or sign in with an existing account and access only their active organizations. Owners can draft and publish versioned PHP proposals; active clients can approve or decline, with approvals atomically creating one planned project. Owners can activate/hold/resume/cancel projects and submit text-only milestones; clients can request changes or accept numbered review rounds. This is not the complete portal or a production release.

## Stack and architecture

React + strict TypeScript + Vite + React Router + CSS modules; Node 24 + Express; PostgreSQL + Prisma 7; Passport local + Argon2id; PostgreSQL-backed sessions; Zod validation; Nodemailer SMTP to a local mail sink.

- `apps/web`: sign-in, invitation onboarding, owner/client organization, proposal editor/review, project lifecycle, and milestone review screens
- `apps/api`: authentication, scoped organization resources, invitation, proposal and milestone review transactions
- `packages/contracts`: shared input schemas and DTOs; no browser ORM models
- `prisma`: additive migrations and session/business constraints
- `docs`: [authentication architecture](docs/architecture/002-authentication-and-invitations.md), [proposal architecture](docs/architecture/003-proposal-approval.md), [project/milestone architecture](docs/architecture/004-project-milestones.md), and [implemented milestone slice](docs/product/milestone-slice.md)

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

Projects start **planned** and display the actual approved scope and cost breakdown. Owners can move Planned → Active → In review; hold/cancellation require a reason. Resume restores the pre-hold state, while cancellation is terminal. Completion is unavailable until a future handover gate exists. Approval is a recorded workflow decision, not a claimed legally binding electronic-signature service.

Milestones move Planned → In progress → In review → Accepted. Requesting changes requires feedback and returns work to In progress. Every submission creates an immutable numbered text snapshot. Withdrawal/reopening require reasons and retain earlier rounds and acceptance. Held/cancelled projects reject workflow writes. Progress counts accepted required milestones; no required milestones displays “No required milestones yet”. Due dates use Asia/Manila, with overdue starting the following day and excluding accepted milestones/cancelled projects. Workflow history records real actors and UTC timestamps.

For an existing local checkout, apply the additive migration without resetting data:

```bash
nvm use
npm run db:generate
npm run db:migrate
```

Existing owner/client accounts and memberships are retained. Stop/restart development servers after migrating; start the mail sink only when testing invitations.

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

## Limitations

Project completion/handover, change requests, billing, uploads, AI, external email delivery, password recovery, MFA, and public signup are not implemented. Owner detail sections show up to 100 records; organization lists have 20-row pages. Projects support 100 milestones and 100 rounds per milestone, unique display-order slots 1–100, and 50 workflow events per page. There is no milestone deletion or order-slot swapping. Due-state displays refresh on reload. SMTP delivery has no durable outbox or automatic retry; a crash can require reissuing an invitation. Login limits are shared by users behind the same IP. Proposal-editor guards cover in-app links/navigation and Back/Forward; supported browsers warn on refresh/tab close. Forced browser exits, crashes, mobile termination and session expiry cannot be guaranteed to preserve unsaved memory.

Production invitation delivery is disabled. Hosting, budget, HTTPS and exact proxy trust, backup/restore, retention, and production abuse controls remain deployment gates. No staging deployment or public demo is available, and no production readiness is claimed.
