# Staging runtime grants and verification

This is a release checklist for the dedicated fictional staging database, not an automatic grant script. No cloud SQL or role provisioning has been performed. Apply only after separate authorization and exact project/branch/database identity checks. Use the direct maintenance connection as the schema owner; the application uses its separate pooled runtime login. Never reuse another project's roles or credentials. See the [staging runbook](staging.md).

## Identity and ownership

The schema-owner role owns `jcb_portal_staging`, the application schema and objects created by migrations. Keep its credential operator-only. The runtime role (`jcb_runtime` in these examples) must be a constrained SQL-created login: NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, with no owner/admin role membership or SET ROLE route. Do not use Neon's default API/Console-created administrator as the runtime identity; [Neon's role guidance](https://neon.com/docs/manage/roles) explains inherited `neon_superuser` privileges. Account IDs and credentials belong in private operator configuration, not this document or Git.

In this new database only, remove unintended PUBLIC CONNECT/TEMP and public-schema CREATE privileges, grant runtime CONNECT and schema USAGE explicitly, and inspect inherited/PUBLIC grants before declaring the role constrained. No runtime ownership, DDL, TRUNCATE, REFERENCES, TRIGGER or grant options. The database role is a trusted backend credential, not an end-user identity; organization isolation remains enforced by the application.

## Current application privilege matrix

Grant against the exact reviewed migration/schema state. Do not grant on every future table automatically. Recheck the matrix after migrations and apply reviewed grants before starting the new application version. Never grant runtime access to `_prisma_migrations`.

| Objects                                                                                                                                                                                    | Runtime permissions                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `session`                                                                                                                                                                                  | SELECT, INSERT, UPDATE, DELETE (session creation, revocation-safe saves, logout and expired-session pruning) |
| `users`                                                                                                                                                                                    | SELECT, INSERT; column-only UPDATE on `id` for the existing row lock below                                   |
| `organizations`, `contacts`, `memberships`, `invitations`, `auth_throttles`                                                                                                                | SELECT, INSERT, UPDATE                                                                                       |
| `proposals`, `proposal_versions`, `projects`, `milestones`, `milestone_reviews`                                                                                                            | SELECT, INSERT, UPDATE                                                                                       |
| `change_requests`, `change_offers`, `deliverables`, `deliverable_versions`, `handover_items`                                                                                               | SELECT, INSERT, UPDATE                                                                                       |
| `activity_events`, `proposal_decisions`, `workflow_events`, `change_decisions`, `change_messages`, `deliverable_decisions`, `deliverable_events`, `project_completions`, `handover_events` | SELECT, INSERT only; no UPDATE or DELETE                                                                     |
| `public._prisma_migrations`                                                                                                                                                                | None; maintenance identity only                                                                              |

Required enum types need USAGE (inspect any PUBLIC defaults). Current IDs use UUID/string values, not application sequences; if a future reviewed migration introduces a sequence, grant only its required USAGE/SELECT. Keep unrelated schemas/functions inaccessible.

### Row locks

`lockOrganization()` in `apps/api/src/proposals/service.ts` locks the organization with `FOR UPDATE`, the actor's `users` row with `FOR SHARE`, and current client membership with `FOR SHARE`. Project workflow code also locks `projects` with `FOR UPDATE`. PostgreSQL requires UPDATE privilege on at least one column even for a `FOR SHARE` lock; SELECT alone is insufficient. The organization/membership/project table grants cover their locks. Use the narrow additional grant:

```sql
GRANT UPDATE (id) ON public.users TO jcb_runtime;
```

This supports the existing lock without granting password-hash, application-role or disabled-state updates. It still permits an ID update through a compromised database credential; protect that credential accordingly. Do not remove locks or grant UPDATE on all user fields to work around permission errors. See [PostgreSQL SELECT privileges](https://www.postgresql.org/docs/18/sql-select.html).

### Trigger and check-function permissions

The current `jcb_*` functions are SECURITY INVOKER by default; they are not privilege-escalation wrappers. Their queries execute with the caller's table privileges. Snapshot/decision guards read related proposal, version, decision and project records. In particular:

- `jcb_change_decision_guard()` locks the project row and reads the original approved amount plus prior approved adjustments before allowing a new decision.
- `jcb_completed_workflow_guard()` resolves the nested record's project and performs `SELECT ... FOR UPDATE` on `projects`. It runs on milestone, deliverable, change and checklist writes. Runtime therefore needs the SELECT/UPDATE project privileges even when the visible action only inserts a review/decision/message.
- Completion-transition guards read completion history; published-version guards read earlier versions/decisions. The matrix includes SELECT on these append-only histories without allowing edits.
- The scalar check helpers `public.jcb_valid_proposal_money(jsonb,bigint)` and `public.jcb_deliverable_links_valid(jsonb)` validate money/link data. Explicitly preserve required EXECUTE on these signatures and schema/type USAGE if restricting PUBLIC function privileges.

The migration/schema owner needs TRIGGER on the target tables and EXECUTE on trigger functions when creating triggers. Runtime does not create triggers and must not receive TRIGGER/DDL privileges. Existing triggers must remain enabled and owned by the maintenance identity; retain SECURITY INVOKER semantics and never introduce SECURITY DEFINER or disable guards to resolve missing grants. Check function ACLs and execute real workflow transactions: an EXECUTE privilege result alone does not prove a trigger's internal table queries or row locks succeed. See [PostgreSQL trigger privileges](https://www.postgresql.org/docs/18/sql-createtrigger.html).

## Verification after authorized migration/grant changes

Connect independently with the runtime credential, not just `SET ROLE` in an administrator session. Use only fictional records in the dedicated staging database. Perform destructive/negative DDL probes in a separately authorized disposable verification database; privilege-check queries below are read-only and do not prove every operation works.

```sql
SELECT current_database(), current_user;
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
FROM pg_roles WHERE rolname = current_user;
-- All privilege booleans above must be false. Verify no inherited owner/admin
-- memberships (including neon_superuser) or SET ROLE paths via pg_auth_members.
SELECT has_database_privilege(current_user, current_database(), 'CONNECT') AS connect_ok,
       has_database_privilege(current_user, current_database(), 'CREATE') AS create_forbidden,
       has_database_privilege(current_user, current_database(), 'TEMP') AS temp_forbidden,
       has_schema_privilege(current_user, 'public', 'USAGE') AS usage_ok,
       has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create_forbidden;
-- Expected: true, false, false, true, false.
SELECT has_column_privilege(current_user, 'public.users', 'id', 'UPDATE') AS lock_ok,
       has_column_privilege(current_user, 'public.users', 'password_hash', 'UPDATE') AS password_update_forbidden,
       has_table_privilege(current_user, 'public.proposal_decisions', 'UPDATE') AS history_update_forbidden;
-- Expected: true, false, false. Check project SELECT and UPDATE separately:
SELECT has_table_privilege(current_user, 'public.projects', 'SELECT') AS project_select_ok,
       has_table_privilege(current_user, 'public.projects', 'UPDATE') AS project_update_ok;
SELECT privilege_type FROM information_schema.role_table_grants
WHERE grantee = current_user AND table_schema = 'public'
  AND table_name = '_prisma_migrations';
-- Expected: no grants, plus verify effective inherited/PUBLIC privileges.
SELECT p.oid::regprocedure AS function, p.prosecdef AS security_definer,
       has_function_privilege(current_user, p.oid, 'EXECUTE') AS executable
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND left(p.proname, 4) = 'jcb_';
-- Expected: no SECURITY DEFINER functions. Check scalar helper EXECUTE rights.
SELECT c.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid)
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal;
-- Compare names/definitions with migrations; normal guards must stay enabled.
```

Check effective privileges on every matrix object (including column-level and PUBLIC/inherited grants), not only the sample tables. Runtime must be unable to own/alter tables, create roles/databases, SET ROLE owner, read/write migration metadata or connect to an unrelated database. Avoid granting broad defaults to make checks pass.

Then use the real API under the runtime connection: session insert/save/touch/logout/pruning; organization and actor/membership row locks; proposal approval/project creation; change approval with exact aggregate bounds; deliverable decision; milestone review and handover completion/reopen. Include concurrent decisions/revocation/status transitions so actual separate connections exercise locks and trigger queries. Invalid/stale mutations must roll back state and history together. Verify the append-only records remain immutable and no permission workaround bypassed guards.

A standalone lock probe can use `BEGIN; SELECT id FROM public.users WHERE id = '<fictional-actor-uuid>'::uuid FOR SHARE; ROLLBACK;` and equivalent organization/project/member probes with matching fictional IDs. Replace the placeholder privately. A missing-row probe checks statement permission but does not prove contention or revocation behavior; the API journey/concurrent requests are still required.

Record executed checks separately from pending checks. Production invitation delivery is currently disabled, so complete hosted client journeys remain blocked until safe onboarding exists. These are verification instructions, not evidence that cloud grants or hosted workflows have passed.
