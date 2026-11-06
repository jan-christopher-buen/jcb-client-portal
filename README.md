# jcb client portal

A client portal for freelance web development and SEO engagements, intended to bring proposals, milestone decisions, and handover into one shared workspace.

**Current status: M1 local foundation.** The application has a responsive sign-in layout and application frame, an Express API, PostgreSQL session infrastructure, and workspace checks. Authentication is not implemented: sign-in controls are disabled and `/api/auth/me` returns 401. No client records or protected workspace is available.

## Stack and architecture

React + TypeScript + Vite + React Router + CSS modules; Node 24 + Express; PostgreSQL + Prisma 7; Zod contracts. One npm workspace repository and lockfile:

- `apps/web`: browser application
- `apps/api`: API and production static serving
- `packages/contracts`: minimal shared runtime schemas
- `prisma`: session schema and migrations
- `docs`: architecture and product decisions

Production serves the web app and `/api` from Express on one origin. Development uses Vite's API proxy. See [architecture decisions](docs/architecture/001-local-foundation.md) and [current scope](docs/product/m1-scope.md).

## Local setup

Requires nvm (or Node **24.22.2**) and a running local PostgreSQL server. No cloud account is required.

```bash
nvm install
nvm use
npm ci
cp .env.example .env
```

Create two local databases using your PostgreSQL administration account:

```bash
createdb jcb_portal_dev
createdb jcb_portal_test
```

Edit `.env` with your local database credentials and a random session secret of at least 32 characters. Never commit this file. Environment names:

| Name                | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `NODE_ENV`          | `development`, `test`, or `production`                      |
| `PORT`              | API port, defaults to 3000                                  |
| `APP_ORIGIN`        | Exact browser origin; local default `http://localhost:5173` |
| `DATABASE_URL`      | Local `jcb_portal_dev` PostgreSQL URL                       |
| `TEST_DATABASE_URL` | Separate local `jcb_portal_test` PostgreSQL URL             |
| `SESSION_SECRET`    | Random secret, at least 32 characters                       |

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:5173`. API liveness is `http://localhost:3000/health`. Keep the default API port for the Vite proxy. The seed command checks connectivity only; there are no users or business fixtures in M1. Migration and seed commands refuse remote hosts or database names other than `jcb_portal_dev`.

## Checks

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
```

Integration checks require `TEST_DATABASE_URL` and migrate only `jcb_portal_test`; they reject development databases and remote hosts. The GitHub Actions workflow supplies its own PostgreSQL service.

`npm run format` applies formatting. `npm run build` compiles all workspaces. After building, `npm start` serves compiled assets and the API from port 3000; stop development servers first. For local single-origin checks, set `APP_ORIGIN=http://localhost:3000`. A real production deployment requires `NODE_ENV=production`, an HTTPS origin, and the host's exact proxy configuration.

## Limitations

This is a local foundation, not a completed client portal. Authentication, invitations, tenant authorization, proposal/project workflows, uploads, and email are pending. System font fallbacks are used until licensed local font assets are added. No public demo or staging deployment exists. Hosting budget, proxy policy, backups, and operational controls must be decided before deployment or real client onboarding.
