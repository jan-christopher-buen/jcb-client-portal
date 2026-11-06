# M2 proposal and approval slice

Implemented journey: owner selects an organization → creates/edits a PHP proposal draft → explicitly publishes → active client member reviews the current snapshot → approves or declines → an approval produces one planned project showing that approved scope.

| Operation                                | Owner                   | Active organization client | Other organization / revoked client |
| ---------------------------------------- | ----------------------- | -------------------------- | ----------------------------------- |
| Create/edit draft, see notes             | Allowed before approval | Denied / omitted           | Denied                              |
| Publish or create revision               | Allowed before approval | Denied                     | Denied                              |
| Read published history                   | Allowed                 | Own organization           | Denied                              |
| Approve/decline current SENT version     | Denied                  | Allowed                    | Denied                              |
| Read decision receipt / approved project | Allowed                 | Own organization           | Denied                              |

Revision drafts stay private and do not replace the current sent version. Publishing supersedes only the prior undecided SENT snapshot. Decisions preserve actor, version, outcome and timestamp. Declining creates no project. Approved proposals stay locked; future additions require a later change-request workflow.

Approval retries return the original result. Conflicting or stale decisions explain why the user must reload; the interface retains the displayed snapshot on failed submission. Owner saves use edit revisions so stale forms cannot silently overwrite another save. Item order is explicit, prices accept exact decimal PHP text, and zero-price items are allowed. Authoritative totals come from saved server records.

Organization pages link to real paginated proposal/project lists. Empty, loading and retry states are present; no fabricated dashboard metrics or milestones are shown. The editor, review history, receipts and planned-project overview preserve lowercase jcb. branding, system font fallbacks, keyboard focus/skip navigation, and horizontally scrollable cost tables on mobile. Decision times display Asia/Manila; storage/receipts use UTC timestamps.

Boundaries: PHP only; 1–100 items; positive bounded integer quantities; bounded whole-centavo prices/totals; 100 versions maximum. No taxes, discounts, partial quantities, milestone progress, billing, uploads, AI, production email or deployment is included. See [ADR-003](../architecture/003-proposal-approval.md) for exact bounds and transaction rules. The earlier authentication slice remains implemented; the full M2 milestone is not claimed complete.

Project lifecycle, milestone progress and navigation protection are now implemented in the [milestone slice](milestone-slice.md), superseding the earlier deferred descriptions above.
