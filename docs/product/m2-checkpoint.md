# M2 local integration checkpoint

The implemented local workflow now connects explicit owner provisioning → invitation/local delivery → client onboarding/sign-in → immutable PHP proposal publication → client approval/one project → milestone submission → requested changes → numbered resubmission → client acceptance. Hold/resume, cancellation and reopening preserve history. Authentication, current organization membership, CSRF/Origin and client-only decisions remain server-enforced.

This checkpoint reviews the combined M1–M2 implementation, not a production release. GitHub's actual default branch is `main`; the implementation remains on `feat/project-milestones`. No push, PR publication, merge, staging deployment or remote CI verification is included.

## Integration fixes

- Invitation writes now use the same bounded serializable retry handling as proposals/projects. The pg adapter can surface raw-lock serialization/deadlock errors as P2010 with a nested SQLSTATE, which the older invitation-only helper missed. The existing acceptance race test now forces overlapping requests on separate API/database connections, including a committed organization-row change while both wait.
- Local database commands reject connection URL query parameters/fragments, preventing pg connection-string host overrides from bypassing the loopback check. Malformed configuration errors omit input values. Dedicated database names and matching development/test rejection remain enforced.
- CI readiness explicitly checks its disposable PostgreSQL role/database. CI uses the pinned Node 24 version, `npm ci`, generated Prisma client, all integration suites, and literal loopback test credentials; it references no production secrets.

## Validation

Executed successfully: lockfile clean install, formatting, lint, typecheck, **16 unit tests and 39 integration tests**, production build and compiled-server smoke checks. A lint-only initialization was corrected before continuing; a final test-assertion tightening was verified with its targeted configuration suite. A fresh disposable PostgreSQL cluster verifies all four migrations from empty history. All four applied checksums match the checked-in SQL in both disposable databases, and repeat migration deployment is a no-op. A separate staged upgrade preserves an M1 session, authentication records and a pre-milestone approved proposal/project across later additive migrations, then exercises the latest compiled API. Existing development/production databases are never reset or migrated by this checkpoint.

Non-blocking pinned-dependency warnings remain: npm install-script policy notices, a pg query-queue deprecation, and Zod/Rollup comment annotations. Dependency versions and the lockfile are unchanged.

Earlier complete browser verification is reused for invitation onboarding and proposal/milestone journeys, mobile/keyboard behavior, errors, duplicate actions and navigation guards. This checkpoint changes backend retry/safety handling and CI/docs; its strengthened real API race test and compiled API journey target those boundaries. No new browser session or hosted verification is implied. Tracked-source review found no secrets, real client records, internal planning prompts or temporary QA artifacts; existing ignores cover planning, environment files, generated output and QA report directories.

## Limits and next milestone

Current limits remain PHP-only precise prices, text-only milestone submissions, bounded histories/order slots and no project completion gate. Unsaved proposal input is held in browser memory; supported navigation/unload warnings cannot guarantee protection from forced exits, crashes or session expiry. External mail, durable delivery retry, files, change requests, handover/completion, billing, AI, recovery/MFA and deployment remain outside this implementation. Font assets still use system fallbacks.

The next product milestone is a separately scoped M3 delivery workflow: structured scope changes, private deliverables and handover/completion gates. None is implemented here. Host/budget approval, HTTPS/proxy configuration, backups/restore, retention, production mail and demo isolation remain release gates. Remote CI must pass after an explicitly authorized push before it can be called verified.
