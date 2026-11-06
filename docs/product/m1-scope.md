# M1 local scope

Implemented: workspace/tooling, session migration, API bootstrap, signed-out contract, sign-in layout, responsive application frame, safe missing-page response, connectivity loading/error/retry states, CI configuration, and local setup documentation.

The shell exposes only Sign in. There are no dashboard metrics, role selectors, business actions, accounts, invitations, or fixture records. A compact inline navigation replaces the desktop sidebar on mobile; with one link a drawer adds no value. Labels, a skip link, visible keyboard focus, and readable disabled controls support the shell's limited interactions.

Brand: lowercase `jcb.`, charcoal surfaces, light text and orange accents. DM Sans and Space Grotesk names have system fallbacks; licensed font assets are still pending. No remote font request is made. Business displays will use Asia/Manila dates and UTC event timestamps when those records exist.

Remaining: M2 authentication and invitations, organizations, versioned proposals and approvals, project workflow, real authorization and business tests. Staging requires host/budget selection and deployment as a separate task; M1's full staging gate remains open. GitHub Actions must run on the remote before CI can be called verified there.

## Permissions baseline for M2

| Resource or action                        | Signed out | Owner                 | Active client member                     |
| ----------------------------------------- | ---------- | --------------------- | ---------------------------------------- |
| Health and sign-in shell                  | Public     | Public                | Public                                   |
| Organization management and private notes | Denied     | All organizations     | Denied                                   |
| Published proposals and projects          | Denied     | All organizations     | Own organization only                    |
| Draft proposals and publishing            | Denied     | Owner only            | Denied                                   |
| Current proposal decision                 | Denied     | Cannot act for client | Own organization, current sent version   |
| Membership and invitations                | Denied     | Invite/manage         | Accept only matching authenticated email |

These are design rules, not implemented permissions. All session identities remain signed out in M1.
