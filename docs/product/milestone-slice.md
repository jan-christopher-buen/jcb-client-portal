# M2 project lifecycle and milestone reviews

Implemented journey: approved proposal → planned project → owner activates → creates/starts milestone → submits text snapshot → active client member requests changes with feedback → owner edits/resubmits a numbered round → client accepts. Required-milestone progress reflects the real current state.

| Action                                                    | Owner                  | Active organization client             | Other/revoked client |
| --------------------------------------------------------- | ---------------------- | -------------------------------------- | -------------------- |
| Read project, review history and safe activity            | Allowed                | Own organization                       | Denied               |
| Change project status, create/edit/start/submit milestone | Allowed in valid state | Denied                                 | Denied               |
| Withdraw pending round / reopen acceptance                | Required reason        | Denied                                 | Denied               |
| Accept / request changes on current round                 | Denied                 | Allowed; feedback required for changes | Denied               |
| Complete project                                          | Unavailable            | Unavailable                            | Unavailable          |

Project status moves Planned → Active → In review. Hold needs a reason and preserves the previous state for resume; cancellation needs a reason and cannot resume. Workflow writes are unavailable while held/cancelled, while reads/history remain available. In review does not itself complete a project. Accepted required milestones alone do not enable completion; handover is a future gate.

Milestones have text descriptions, optional date-only due dates, required flags and stable explicit display order. Submitted title/description snapshots are immutable. The owner must withdraw with a reason before revising a pending review, or reopen with a reason after acceptance. Earlier feedback, decisions and acceptance remain readable. Superseded/withdrawn review actions conflict instead of silently acting on newer work. Identical current-round decision retries return the existing result; different feedback/outcomes conflict.

Progress displays accepted required / total required. With no required milestones it displays “No required milestones yet”. Overdue begins after the due date in Asia/Manila, excludes accepted milestones and cancelled projects, and refreshes when the screen reloads. Event timestamps are stored in UTC and displayed in Asia/Manila.

Owner/client screens provide next actions, loading/error/empty states, retry/reload controls, pending-submit protection, mobile layouts and keyboard focus. Failed saves retain input. Proposal-editor navigation offers keep/discard for in-app links and browser history; supported browsers also warn on refresh/tab close. Forced exits, crashes and mobile process termination cannot be guaranteed to warn or retain unsaved memory.

Limits: 100 milestones/project, 100 review rounds/milestone, unique order slots 1–100, 50 activity events/page. No milestone deletion/reordering swaps, uploads/public file links, change requests, handover/completion, billing, AI, external email, recovery/MFA or deployment. This is a local core workflow, not a full product or production-readiness claim. See [ADR-004](../architecture/004-project-milestones.md).
