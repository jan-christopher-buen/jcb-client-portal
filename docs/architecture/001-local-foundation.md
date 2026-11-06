# ADR-001: Local modular monolith

Status: accepted for M1 local work. Hosting is undecided. Authentication and invitation behavior is now superseded by [ADR-002](002-authentication-and-invitations.md); the M1 details below are retained as the foundation decision record.

Use npm workspaces with React, strict TypeScript, Vite, React Router, and CSS modules in `apps/web`; Express 5 and ESM in `apps/api`; small Zod contracts in `packages/contracts`. PostgreSQL holds server-side sessions. Production Express serves the compiled web app and API from one origin; Vite proxies `/api` during development.

Node 24.22.2 is the verified current Node 24 patch, installed through the existing nvm and pinned in `.nvmrc`. Prisma CLI, client, and PostgreSQL adapter are pinned together at stable **7.10.1**. Prisma 8 is currently an RC and excluded. Prisma 7 supports Node 24 and TypeScript 5.9; configuration uses `prisma.config.ts`, the `prisma-client` generator with explicit output, and the `pg` driver adapter. The lockfile records resolved versions.

Sources checked during setup:

- [Prisma 7 PostgreSQL configuration](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql)
- [Prisma 7 migration requirements and adapter setup](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)
- [Official Node 24 distributions](https://nodejs.org/dist/latest-v24.x/)

Only the session table is migrated. The Prisma model matches connect-pg-simple's JSON session and expiry format. Database clients remain backend-only. No business schema or user provisioning exists yet. The seed command checks connectivity and deliberately creates no records.

Alternatives deferred: Next.js adds an unnecessary framework change; separate frontend/backend origins complicate cookies; JWT browser storage is unnecessary; cloud provisioning and a storage provider are outside local M1.

## Security boundaries

`/health` returns liveness only. `/api/auth/me` always returns 401. Unknown endpoints return structured 404 responses. No login, registration, session identity, CSRF token, or mutation route is implemented. Before M2 mutations: add synchronizer CSRF tokens and allowed-Origin checks, login throttling, Argon2id, Passport local, session regeneration, logout/revocation, and authorization tests.

Sessions use PostgreSQL, HttpOnly host-only cookies, SameSite=Lax and an eight-hour expiry; Secure is enabled in production. Anonymous reads do not create sessions. Secrets are validated and errors omit raw details. Helmet supplies baseline headers. This does not establish completed authentication or tenant isolation.

Proxy trust is explicitly `false`, suitable for direct connections. Before deploying behind a proxy, specify that host's exact trusted proxy addresses/hops and verify HTTPS detection, secure cookies, request IPs and throttling. Do not blindly enable `trust proxy: true`. Production origin must be HTTPS. No staging deployment or production readiness is claimed.

Local database commands require a loopback host and exact `jcb_portal_dev` name. Integration commands require `TEST_DATABASE_URL`, loopback host, and exact `jcb_portal_test` name; they reject a matching development database. Integration migration runs before session-store tests. No reset/drop command is supplied. Tests delete only their uniquely identified session.

No paid resource or external service is provisioned. Hosting choice, operating budget, backups/restore, retention, demo separation, and production mail/file services remain release gates.

Tooling versions are pinned in the manifests and lockfile. Vite 7.3.7 with React plugin 5.2.0 was selected after Vite 8.3.6 was rejected by the existing npm minimum-release-age policy; that user policy was preserved. ESLint 10 replaces the unsupported 9 line. CI uses the current [checkout](https://github.com/actions/checkout) and [setup-node](https://github.com/actions/setup-node) v7 actions with read-only repository permissions.
