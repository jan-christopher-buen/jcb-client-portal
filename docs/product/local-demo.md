# Local fictional demo walkthrough

This is an explicitly opt-in local demonstration, not a public demo or production deployment. It uses normal sign-in, PostgreSQL sessions, CSRF/Origin checks and organization authorization. There is no demo-login endpoint or privileged browser bypass. Do not use real client data, reused passwords or private external resources.

## Setup

Use the pinned Node version, existing dependencies and a running local PostgreSQL server. Create a separate database; do not rename or reuse development/test/production databases.

```bash
nvm use
createdb -h 127.0.0.1 -p 5432 jcb_portal_demo
export NODE_ENV=development
export JCB_LOCAL_DEMO=1
export DEMO_DATABASE_URL='postgresql://127.0.0.1:5432/jcb_portal_demo'
DEMO_PRIVATE_DIR="$(mktemp -d /tmp/jcb-local-demo-XXXXXX)"
npm run demo:seed -- --confirm-empty-demo --credentials-file "$DEMO_PRIVATE_DIR/credentials.json"
npm run demo:dev
```

Adjust only the local PostgreSQL role/port/credentials in `DEMO_DATABASE_URL` if needed. The database name must remain exactly `jcb_portal_demo`; only loopback hosts and plain URLs without query/fragment overrides are accepted. Both `NODE_ENV=development` and `JCB_LOCAL_DEMO=1` are required. Existing normal `.env` development/test URLs are not seed targets. `demo:seed` applies the checked-in additive migrations only after the empty-database check. Neither normal startup nor `npm run db:seed` invokes it.

Open the generated credentials file privately in a local editor. It contains three fictional emails with independently generated runtime passwords and project links. The seed creates it exclusively with `0600` permissions outside the checkout (including outside ignored directories), refuses existing files/symlink destinations, and never prints passwords or invitation tokens. Do not paste it into issues, commit it, share it publicly or reuse its passwords. Keep the file until the demo is no longer needed; `/tmp` may be cleared by the operating system. There is no password recovery feature.

The launcher serves the web app at `http://localhost:5173` and binds API/Vite to loopback. It supplies an ephemeral session secret in the child process, not a file or log. Restarting the launcher invalidates existing browser cookies; sign in again. Stop it with Ctrl+C. Keep this checkout and local database on a trusted development machine; loopback binding is not a public-hosting security design.

For a new invitation during the walkthrough, run `NODE_ENV=development npm run mail:dev` in another terminal, then open `http://localhost:8025`. The sink holds invitation emails in memory and must stay local. The initial seed consumes its invitations through the normal onboarding service with in-memory delivery; it sends no email and leaves no usable raw invitation tokens. Subsequent owner invitations use the real local sink.

## Roles and starting scenes

Use separate browser profiles/private contexts for the owner, Harbor reviewer and Luma reviewer, using the private file's credentials.

- **Owner:** manages both organizations and workflow records. Only clients decide on published scope, milestones and deliverable versions.
- **Harbor Dental Studio (fictional demo):** an active website project needing action. Its milestone review has change-request/resubmission history. A PHP 1,500.00 scope adjustment is approved but not yet marked implemented. Deliverable v2 awaits client acceptance; handover is unchecked.
- **Luma Interiors (fictional demo):** a completed project with two preserved completion cycles, a reasoned reopen and repeated handover confirmation. Read its milestone rounds, offer receipt, deliverable versions and immutable closure snapshots. Workflow writes are unavailable until the owner explicitly reopens it.

Both projects preserve their original PHP 35,000.00 proposal separately from the PHP 1,500.00 approved adjustment and PHP 36,500.00 revised agreement. There is no invoice, refund, tax or payment ledger. Optional owner-only checklist notes are omitted from client views. Public `example.com` links are fictional external destinations; provider access rules apply and HTTPS does not guarantee safe/private content.

## One full transaction

1. As owner, open Harbor → Proposals and projects → its project. Review the original scope, required milestone progress and current activity. As Harbor client, compare published history; the Luma organization must remain inaccessible.
2. Open Harbor's change request **Appointment introduction**. The client approval receipt authorizes its offered scope and amount. As owner, record implementation with a client-visible note. This records owner work; it is not client acceptance or completion.
3. As Harbor client, review deliverable v2, earlier feedback and v1. Accept the current version, or request changes with feedback and let the owner prepare/publish a new draft. Acceptance belongs to that version; a replacement requires fresh acceptance.
4. As owner, move Active → In review and open **Handover and completion readiness**. Read concrete blockers. Mark the required documentation task complete with a reason. Optional private notes are not client tasks and must contain no credentials.
5. Explicitly confirm completion once ready. The API rereads all authoritative records under the project lock and saves one immutable completion snapshot. Earlier readiness is advisory; a concurrent reopen/replacement/unchecked task/new request can invalidate it.
6. As client, inspect the read-only checklist and completion snapshot. As owner, explicitly reopen to In review with a reason, uncheck/recheck the required task, then confirm a fresh completion. Earlier cycles remain readable.

To demonstrate the beginning of the workflow, invite another fictional `example.test` contact through the local sink, complete onboarding in a new browser profile, then create/publish a new PHP proposal and approve it as that client. Its new planned project can follow milestone review → scope offer/decision/implementation → versioned deliverable review → handover → closure. No contacts or unpredictable IDs grant access by themselves.

## Repeating or recovering the demo

The seed refuses unexpected user schemas, views/foreign tables, row-security policies and **all existing application/data rows**, including an already-seeded demo (migration history alone is allowed), and serializes concurrent seed attempts with a database advisory lock. It contains no reset/delete/replacement option. No existing data is silently replaced. An existing credential file also causes refusal. A failed run may leave a partially built but constraint-valid demo and an empty credential file; retain it for inspection instead of rerunning blindly. Restoring a deliberately fresh dedicated demo database is an explicit operator task outside this command; never reset development, test or production data. Automated public-demo reset/recovery is deferred.

This demonstrates local workflow behavior. Private storage/uploads, public demo isolation/hosting, production email, recovery/MFA, billing, AI and deployment remain unfinished. The original full MVP is not complete.
