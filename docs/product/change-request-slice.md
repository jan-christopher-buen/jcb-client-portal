# M3 first slice: client-approved scope changes

Implemented: active client requests a project scope change → owner asks clarification → client responds → owner drafts/publishes an exact PHP offer → client approves or declines → approved amounts update → owner records implementation with a note.

The original approved proposal remains unchanged. Original amount, approved adjustments and revised agreed amount appear separately. Approval includes positive, zero or negative adjustments, but cannot make the revised amount negative or exceed the supported bound. Draft/pending/declined/superseded offers do not count. Duplicate decisions preserve one receipt and one adjustment contribution, including concurrent decisions on different requests.

| Action                                       | Owner                   | Active organization client           | Other/revoked client |
| -------------------------------------------- | ----------------------- | ------------------------------------ | -------------------- |
| Create request                               | Denied                  | Allowed on own working project       | Denied               |
| Read request/published history               | Allowed                 | Own project                          | Denied               |
| Clarify before pending offer / after decline | Allowed                 | Respond when clarification requested | Denied               |
| Owner notes / draft content                  | Allowed                 | Omitted                              | Denied               |
| Draft/edit/publish or replace offer          | Allowed before approval | Denied                               | Denied               |
| Approve/decline current offer                | Denied                  | Allowed                              | Denied               |
| Mark approved request implemented            | Required note           | Denied                               | Denied               |

Publishing a replacement atomically supersedes the current pending offer. A draft alone does not invalidate it. Approved offers cannot be changed or replaced. Earlier offers, receipts and discussion remain readable. Implementation records owner work; it is not client acceptance or project completion. Schedule impact is required descriptive text; dates change only through a separate owner action.

Held/cancelled projects retain authorized reads and block every workflow mutation. A held project must resume before decisions/implementation; cancelled projects cannot resume. Existing session, CSRF/Origin and active-membership controls apply throughout.

The UI includes project amount summaries, paginated request lists, client creation, discussion visibility labels, owner offer editors, explicit current-version/history screens, receipts and implementation notes. Loading/error/empty states, failed-save input retention, duplicate-click guards, mobile layout and keyboard access are included. Draft protection is browser-memory based and cannot cover every forced exit.

Bounds: 100 requests/project, 100 offers/request, 100 discussion entries/request; ±100,000,000,000,000,000 centavos per adjustment; revised amount 0–100,000,000,000,000,000 centavos. PHP only, no fractional centavos or automatic date changes. See [ADR-005](../architecture/005-change-requests.md).

Files, handover/completion, billing/payment collection, AI, production email, recovery/MFA and deployment remain excluded. No remote CI success is claimed for this branch before it is pushed and its workflow completes.
