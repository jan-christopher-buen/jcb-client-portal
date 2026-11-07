# Free-tier staging preparation

Prepared 2026-11-07; no cloud resources or deployments have been created by this change. Fictional data only. This is an operational plan, not a production-readiness claim or a public demo. Preserve normal authentication, organization membership and authorization. Never run the loopback-only demo commands against staging, copy a demo database to staging, publish credentials, or add a demo-login bypass.

## Provider assumptions and service settings

Official references checked: [Blueprint specification](https://render.com/docs/blueprint-spec), [Render web services](https://render.com/docs/web-services), [Node version selection](https://render.com/docs/node-version), [deploy lifecycle](https://render.com/docs/deploys), [health checks](https://render.com/docs/health-checks), [Free limitations](https://render.com/docs/free), [Render edge topology](https://render.com/articles/how-render-handles-ddos-attacks), [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/), [Neon pooling](https://neon.com/docs/connect/connection-pooling), [Neon logical backups](https://neon.com/docs/manage/backup-pg-dump), and [node-postgres TLS](https://node-postgres.com/features/ssl). Provider plans and quotas can change; recheck before a separately authorized provisioning task.

The root `render.yaml` records the settings below without applying them. Blueprint creation itself can trigger an initial deploy despite auto-deploy being off; do not create/sync it until separately authorized, the reviewed change is merged, secrets and database migrations are ready, and all release gates are resolved. The Blueprint explicitly selects Render Singapore; pair it with a separate Neon project in `aws-ap-southeast-1`. Render regions are immutable after creation. The file has been validated locally against Render’s public JSON schema; no Render CLI/API validation or apply has been run. Before a separately authorized release, also run `render blueprints validate render.yaml` with a compatible Render CLI and recheck platform acceptance. Configure a single Render native Node web service; do not create Render Postgres. Use a separate Neon Free project/database containing no real data, preferably in the nearest available region. Keep paid upgrades disabled and review both dashboards' quotas before proceeding.

| Setting            | Value                                                                             |
| ------------------ | --------------------------------------------------------------------------------- |
| Compute            | Free, one web instance                                                            |
| Repository root    | Repository root, no subdirectory                                                  |
| Node               | `24.22.2` from `.nvmrc`; do not override with a different `NODE_VERSION`          |
| Build              | `node scripts/check-staging-release.mjs && npm ci --include=dev && npm run build` |
| Start              | `APP_ORIGIN="$RENDER_EXTERNAL_URL" npm start`                                     |
| Health path        | `/health`                                                                         |
| Auto deploy        | Off; controlled manual release after CI and migration review                      |
| Pre-deploy         | None; unavailable on Free                                                         |
| Persistent storage | None                                                                              |

Build generates Prisma and compiles contracts, React and Express. Express serves the frontend and `/api` from the same origin; no separate frontend host or CORS wildcard is needed. Startup binds Render's `PORT` on `0.0.0.0` and performs no migrations or seeding. `/health` is process liveness only, not proof of database readiness; separately test an authenticated database-backed request. Render terminates HTTPS before internal HTTP forwarding. Free instances sleep after inactivity and have ephemeral filesystems; cold starts and free quotas are staging limitations. Shell access is unavailable. Free SMTP egress is restricted; this application independently disables production mail.

## Release selection and assigned origin

`JCB_RELEASE_SHA` is a non-secret service setting supplied privately by the release operator, not a SHA embedded in Git. After merging/reviewing a release and checking CI for its final full SHA, set that value through Render's environment settings without triggering a deploy, then use **Deploy a specific commit** with the same SHA. Do not set it automatically from `RENDER_GIT_COMMIT`: that would bypass approval. The Blueprint sets `SKIP_INSTALL_DEPS=true` to disable Render’s implicit dependency install; only the explicit lockfile install runs after the guard. The build guard requires exactly 40 lowercase hexadecimal characters and equality with Render's actual `RENDER_GIT_COMMIT`; missing, malformed or mismatched values stop the build before `npm ci`. Every subsequent release updates the service setting, so no commit needs to contain its own final hash. Existing running instances are not stopped by this build-only gate. Keep auto-deploy off and verify the live deploy SHA after every release or rollback; an older release without the guard file cannot use this build command.

The start command assigns `APP_ORIGIN` from Render's documented `RENDER_EXTERNAL_URL`, overriding any stale manually supplied `APP_ORIGIN`. There is no guessed hostname, fallback origin, request-header inference or wildcard. The existing production validator rejects an absent/non-HTTPS URL or one with a path, credentials or trailing slash. This setting intentionally uses the assigned `onrender.com` origin; adding a custom domain later requires a separately reviewed origin change. Leave `PORT` to Render. The provider variables and release selection are described in [Render's environment reference](https://render.com/docs/environment-variables) and [specific-commit deployment guide](https://render.com/docs/deploys#deploying-a-specific-commit).

## Environment reference (placeholders only)

Store runtime values in Render's secret environment settings, not Git. Never put database URLs, passwords or session secrets in `VITE_*` variables, build output, screenshots or logs. No secret is needed by the React bundle.

| Variable                 | Runtime value / purpose                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`               | `production` (staging still uses production cookie/security behavior)                                                                      |
| `SKIP_INSTALL_DEPS`      | `true` in the Blueprint; dependency installation is explicitly controlled by the build command                                             |
| `JCB_RELEASE_SHA`        | `<approved-full-40-character-lowercase-commit-sha>`, set after review/CI; never derived from the deploying SHA                             |
| `APP_ORIGIN`             | Derived at startup from Render’s `RENDER_EXTERNAL_URL`; exact assigned HTTPS origin, no path/trailing slash                                |
| `DATABASE_URL`           | `postgresql://<runtime-role>:<encoded-password>@<neon-endpoint>-pooler.<region>.aws.neon.tech:5432/jcb_portal_staging?sslmode=verify-full` |
| `SESSION_SECRET`         | `<unique-random-secret-at-least-32-characters>`; generate locally with a cryptographic generator, store privately                          |
| `TRUST_PROXY`            | `render-edge`, only on Render production (`RENDER=true` supplied by Render)                                                                |
| `PORT`                   | Use Render's supplied value; no fixed local port                                                                                           |
| `LISTEN_HOST`            | Leave unset; loopback override is only for local tooling                                                                                   |
| `SMTP_HOST`, `SMTP_PORT` | Leave unset; production mail remains disabled                                                                                              |

`TRUST_PROXY` defaults to `off`. `render-edge` trusts exactly one immediate hop, not every address in `X-Forwarded-For`. Render documents Cloudflare plus load balancers; this is **not** a claim of a single end-to-end proxy. The conservative policy may identify a shared upstream proxy for rate limiting, causing shared limits. Do not expand hops to obtain a desirable IP. Before exposing staging to testers, verify ingress-only reachability, that Render overwrites forwarded protocol/host appropriately, and that spoofed headers cannot change security decisions. Confirm topology with Render if ambiguous. Do not add another CDN/custom proxy without reviewing this policy. No debug endpoint exposing IPs/headers is added.

Production requires `sslmode=verify-full` and rejects connection override parameters; do not use `rejectUnauthorized=false`, `no-verify` or custom host overrides. The installed pg driver verifies Neon against system CAs and the hostname. Runtime uses at most five Prisma connections plus two session connections per process, with ten-second connect/idle timeouts. Deploy overlap can temporarily double this; reserve capacity for migration/backup connections. Pooled runtime traffic and direct maintenance traffic are distinct. Enforce least privilege: use a separate runtime role with only required schema/table/sequence permissions, no DDL/role management; verify grants after every migration. Keep the schema-owner credentials only on the operator machine. The [runtime-role grant and verification guide](staging-runtime-role.md) covers application tables, trigger functions and row-lock privileges.

## Explicit migration and owner procedure

No automatic database operation runs at build/start. Free hosting lacks pre-deploy commands and shell access, so use a trusted operator terminal with this exact reviewed checkout, pinned Node, and `npm ci --include=dev`. Review SQL and take a backup first. Confirm the Neon project/branch identity in its console, including that it contains only fictional staging records; a hostname/database guard cannot prove the account's purpose. Use additive/backward-compatible migrations while an older app may be running. Otherwise pause access during a maintenance window. Never use `migrate reset`, `db push`, or demo seeding. Application rollback does not roll back schema.

Create a private ignored `.env.staging-operator` file (`chmod 600`), populated through a secure editor:

```dotenv
NODE_ENV=production
JCB_STAGING=1
STAGING_DATABASE_HOST=<exact-direct-neon-hostname>
DATABASE_URL=postgresql://<schema-owner>:<encoded-password>@<exact-direct-neon-hostname>:5432/jcb_portal_staging?sslmode=verify-full
```

The database must be named exactly `jcb_portal_staging`; the direct hostname must start `ep-`, end `.neon.tech`, and not use `-pooler`. These operator settings must not be uploaded to Render. Run from the repository root:

```bash
npm ci --include=dev
npm run db:generate
npm run build -w @jcb/contracts
node --env-file=.env.staging-operator node_modules/tsx/dist/cli.mjs scripts/staging-migrate.ts
# Inspect status with the same private environment:
node --env-file=.env.staging-operator node_modules/prisma/build/index.js migrate status
# Provision exactly one fictional owner, with a hidden password prompt:
node --env-file=.env.staging-operator node_modules/tsx/dist/cli.mjs scripts/owner.ts --staging --email owner@example.test --name 'Fictional staging owner'
```

The migration launcher resolves the checkout-local Prisma CLI, invokes it with the current Node executable, and anchors both `--config` and the child working directory to this checkout; no global Prisma or project `.bin` entry in `PATH` is needed. Child output is captured with a bounded buffer and is not echoed, because it may contain connection secrets. Refusals, launch errors, signals and failed exits produce sanitized diagnostics and a nonzero exit code. On failure, inspect migration status privately before retrying; a failed command does not prove no migration was applied.

Mutating commands require an interactive exact `staging <host>/jcb_portal_staging` confirmation before connecting. Owner provisioning refuses an existing owner/email and never upgrades a browser-supplied role. Do not run concurrent owner-provisioning commands. The default local owner command, local migrations, tests and demo still enforce their original loopback safeguards. Operator commands must not inherit a different `DATABASE_URL`; existing shell values override env-file values, so use a clean terminal and confirm project identity privately. Prisma status/log output may identify the host/database; never publish operator transcripts or credentials.

No staging seed is added. Create fictional organizations and workflow records through authorized API/UI actions after hosted checks. Client onboarding is currently **blocked**: the production mailer returns `MAIL_DISABLED`, with no raw token returned to the browser. Do not expose a local mail sink, read tokens from logs, or mint client accounts directly as a workaround. Full two-client staging verification remains pending a separately approved safe invitation-delivery capability. The owner can verify sign-in and owner workflows now; this limitation must remain visible in any staging demonstration.

## Manual backup and restore drill

Use a trusted workstation with PostgreSQL tools at least as new as the Neon server (confirm `SHOW server_version`), sufficient encrypted local storage and a private libpq service/password file. Configure separate `jcb-staging-backup` and `jcb-staging-restore` services with exact **direct** Neon hosts, port 5432, database names and `sslmode=verify-full`; put passwords only in a mode-0600 password file. Keep all files/dumps outside the checkout. Service definitions are operator-local; do not paste credential URLs into shell history.

1. Verify source identity using its service connection (`current_database()`, `current_user`, server version), and compare with the Neon console. Record migration names/checksums and non-sensitive row counts privately. Stop staging writes for a simple consistent recovery checkpoint; pg_dump itself takes a consistent snapshot.
2. Create a restricted destination directory and backup:

   ```bash
   umask 077
   pg_dump --dbname='service=jcb-staging-backup' --format=custom --no-owner --no-acl --file=/secure/private/jcb-staging.dump
   pg_restore --list /secure/private/jcb-staging.dump
   sha256sum /secure/private/jcb-staging.dump
   ```

3. Encrypt/store the dump securely outside Render's ephemeral disk. It contains password hashes, sessions and fictional business history; treat it as sensitive. Define an operator-owned retention period (proposed seven days), deletion schedule and backup before each migration. No automatic backups or restore guarantee is claimed.
4. Restore **only into a separately authorized empty disposable database**, never the live staging, development, test or production database. Confirm the restore service points to that destination, verify it has no application tables, and keep the application disconnected. Do not use `--clean` or drop/reset commands.

   ```bash
   pg_restore --dbname='service=jcb-staging-restore' --exit-on-error --single-transaction --no-owner --no-acl /secure/private/jcb-staging.dump
   ```

5. Compare migration checksums, table counts, proposal snapshots, accepted-version decisions, project totals, required-record readiness and completion/reopen history. Run migrations/status from the reviewed release only after assessing compatibility. Restore runtime grants explicitly because ownership/ACLs were excluded. Before exposing a recovery, invalidate restored sessions/revocations and rotate `SESSION_SECRET`; never revive old authenticated cookies. Verify logout and organization isolation. A restore drill is pending until actually executed against an authorized disposable destination; do not claim a backup is recoverable from `pg_restore --list` alone.

## Hosted release verification checklist

All items below remain pending. Use fictional records and separate browser profiles; keep evidence private and secret-free.

- [ ] Exact pinned Node/build/start succeeds within Free memory/time limits; `/health` returns 200; `/`, `/sign-in` and direct SPA deep links return the built frontend; unknown `/api` routes remain JSON 404.
- [ ] Database TLS/hostname validation works; deliberately invalid CA/hostname fails in an isolated test. Pool usage stays within budget through cold starts and deploy overlap; sessions persist across restart.
- [ ] HTTPS origin is exact. Cookie is Secure, HttpOnly, SameSite=Lax, host-only; HTTP redirects at the edge. Spoofed `X-Forwarded-Proto`, host and IP headers cannot bypass cookie/origin/rate-limit policy. Observe ingress topology privately; do not trust client-supplied leftmost IPs.
- [ ] CSRF/login/logout: missing/invalid CSRF and wrong Origin fail; valid login regenerates session/CSRF, invalid login is generic and throttled. Logout destroys the session; replaying the old cookie, including a delayed CSRF request, stays unauthorized. Expiration behaves as documented. No secrets/raw tokens appear in application or provider logs.
- [ ] Owner provisioning has no public registration path. Invitation attempt fails safely with `MAIL_DISABLED`; do not present this as delivered. Resolve the onboarding blocker before inviting testers.
- [ ] Once safe client onboarding is available: two fictional organizations, client A/B direct-API cross-access denial, revoked membership denial, draft/internal-note invisibility, and server-enforced owner/client roles.
- [ ] Proposal publish/approve creates one project; milestone changes/resubmit/accept; change offer approval/implementation preserves original scope and precise totals; deliverable replacement needs fresh acceptance; handover readiness checks all required records; complete/reopen/recomplete preserves history. Held/cancelled/completed writes fail appropriately. Duplicate/stale actions and editor recovery retain edits without overwriting newer revisions.
- [ ] Backup/restore drill passes; CI for the exact release passes; dependencies, monitoring, quota/budget alerts and retention have named owners. No debug routes or public credentials.

Private uploads/storage, production email, recovery/MFA, billing/payment collection and AI remain deferred. Workflow completion is not payment, legal certification or independent verification of external links. Free-tier staging is not production readiness, and the original full MVP remains incomplete while private storage is deferred.
