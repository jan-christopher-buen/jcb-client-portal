# M2 first slice: authentication, organizations and invitations

Implemented: explicit local owner provisioning, email/password sign-in, eight-hour sessions, logout, Origin/CSRF checks, persistent login throttling, owner organization/contact editing and archiving, email invitations through a local sink, token-bound client onboarding, existing-user acceptance, membership revocation, scoped organization reads, and safe access activity.

| Operation                                                     | Signed out            | Owner                     | Active client member          |
| ------------------------------------------------------------- | --------------------- | ------------------------- | ----------------------------- |
| Sign in / session CSRF                                        | Allowed               | Allowed                   | Allowed                       |
| Inspect valid invitation                                      | Token required        | Token required            | Token required                |
| New account from invitation                                   | Token + name/password | Use existing identity     | Use existing identity         |
| Accept existing-account invitation                            | Must sign in          | Matching invited identity | Matching invited identity     |
| Create/edit/archive organizations and contacts                | Denied                | Allowed                   | Denied                        |
| Read organization                                             | Denied                | All                       | Active own organizations only |
| Private notes, contacts, invites, memberships, access history | Denied                | Allowed                   | Omitted                       |
| Issue invitation / revoke membership                          | Denied                | Allowed                   | Denied                        |

There is no client role selector, self-service owner registration, metrics dashboard, or project/proposal placeholder presented as live data. Client views display real organization access and state that workflow features are deferred.

Access is checked in API queries even for direct URL/ID requests. Invalid credentials use generic errors; inaccessible organizations return 404. Validation/conflicts use safe stable JSON errors. UI forms retain ordinary input after failed requests, show loading/error states, and disable pending actions. Navigation is compact and wraps on mobile, with a keyboard skip link and focus indicators. Asia/Manila is used for displayed access-event timestamps.

The M1 document records the earlier foundation snapshot. This document and ADR-002 describe current behavior. Versioned proposals, approvals and planned projects were added in [the proposal slice](proposal-slice.md). Milestones remain deferred. Remote CI, staging and production operations have not been enabled by this implementation.
