# M3 integration checkpoint and release gates

Local checkpoint based on merged handover main `52d17e2` (November 7, 2026). This is a review of implemented delivery workflows and an opt-in local demonstration, not completion of the original full MVP. Private files/storage remain deferred.

## Review and changes

Reviewed invitation-bound identity, immutable proposal approval/one-project creation, milestone review rounds, versioned exact-PHP scope offers, implementation, deliverable acceptance, handover readiness, completion and reasoned reopening. Existing shared organization → enabled actor/current membership → project coordination and bounded serializable retries remain in force. Current-version acceptance, aggregate money bounds, all-record readiness and completed-state rejection retain their existing database/service checks. No speculative domain refactoring or new business module was added.

The new demo CLI builds two fictional organizations with service-owned transitions: one active project needing action and one completed project with two closure snapshots. Normal startup/`db:seed` remain unchanged. Explicit development/demo configuration, a dedicated loopback database, empty-data confirmation, exclusive private credential output and nonempty-data refusal protect normal databases. The final guard review tightened refusal of unexpected schemas, views/foreign tables and row-security policies so hidden data cannot look like an empty demo. The demo's API listener can be pinned to loopback; no browser authentication shortcut is introduced. CLI typechecking now includes the Express session declarations needed when reusing existing services.

Application errors/logging continue to omit request payloads, raw database errors, passwords, tokens and session secrets. Seed failures use a generic message; generated credentials are written privately, not printed. SMTP content remains visible only in the existing intentional local mail inbox.

## Verified locally

- [x] Updated main contains merged project-handover work; checkpoint preserves its history.
- [x] Runtime-only demo credentials, private file permissions, fictional active/completed data, normal invitation consumption, unsafe target/reseed refusal.
- [x] Formatting, lint, typecheck and production build.
- [x] 35 distinct unit tests across the full run and final targeted guard rerun, plus 72 guarded integration tests, including independent-connection races, revocation, isolation, current-version decisions, money bounds, full-record readiness, completed writes and rollback.
- [x] Seeded-scene browser review and a full local-mail invitation → onboarding → proposal approval → milestone → change offer/approval/implementation → deliverable → handover → completion → reopen/recompletion journey. Direct API cross-client/revoked-member denial, completed-state write protection, failed-submit/stale recovery, mobile and keyboard checks passed.
- [x] Compiled production-mode health, protected API denial, SPA deep links/assets and compiled-service reads of upgraded earlier records.
- [x] Nine additive migrations applied to fresh disposable databases; earlier session, identity, proposal/project, accepted milestone/deliverable and implemented-change records retained through the staged pre-handover upgrade.

The separate [demo walkthrough](local-demo.md) contains safe local commands, role-specific screens and one full transaction. The original M2 checkpoint is historical; it does not establish a later branch's CI or deployment result. Non-blocking pinned-dependency notices remain: pg query-queue deprecation, Zod/Rollup comment annotations and the browser bundle size warning. Dependency versions/lockfile are unchanged.

## Remote CI pending for this branch

- [ ] Push this branch only in a separately authorized task.
- [ ] Observe its GitHub Actions run complete successfully on a clean checkout. Current workflow uses pinned Node, lockfile install, a dedicated local PostgreSQL test database, generated Prisma client, guarded migrations/tests and build. It references no production credentials. The demo remains opt-in and is not auto-seeded by CI.

## Deployment and operational work pending

- [ ] Hosting, budget and a separate public-demo architecture with controlled isolation/reset/recovery.
- [ ] HTTPS, exact proxy trust, secure-cookie/IP throttling verification on the chosen host.
- [ ] Backups and a tested restore procedure, retention/deletion policy and secret management.
- [ ] Production abuse controls, email delivery/outbox/retry policy and monitoring.
- [ ] Staging browser journeys and production-specific verification. No deployment or service provisioning was performed by this checkpoint.

## Deferred product scope

- [ ] Private uploads/storage with authorization, file validation, retention and controlled downloads.
- [ ] Production email, password recovery and MFA.
- [ ] Billing/payment collection, AI and later integrations.
- [ ] Broader dashboard/general commenting requirements from the original product brief and any remaining release acceptance gates.

Workflow closure is not payment, legal certification or independent validation of external resources. Local fictional data and successful checks do not establish production readiness.
