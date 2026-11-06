# Handover and workflow completion

From project overview, open **Handover and completion readiness**. The owner creates ordered tasks, marks them complete with reasons, and sees concrete blockers. Clients see only client-visible tasks, blockers, safe history and completion summaries; they cannot mark owner work complete or close/reopen projects. Never store credentials or secrets in task text.

A project needs In review status and at least one required milestone, deliverable and checklist task. Required milestone rounds and current published deliverable versions must have client acceptance. Required tasks must be complete. Approved changes must be implemented; unresolved clarification/requests/offers and all unfinished offer drafts block closure. Clean declined requests and reasoned explicit closures are terminal. Frozen offer drafts can be explicitly abandoned without changing the approved offer or amount. No history is deleted.

Readiness is advisory. Owner confirmation rechecks all authoritative records transactionally. Success records a timestamped completion cycle and immutable references to accepted work, change state and checklist state. Duplicate completion does not create another cycle. A stale readiness screen cannot authorize closure after other work changes.

Completed projects remain readable and reject workflow changes. The owner can reopen explicitly to In review with a reason. Earlier completion remains in history; later completion needs a fresh gate check. Editing a checklist task clears its check. Unchecking and required-flag changes are explicit reasoned, audited actions. Optional work can remain incomplete; owner-chosen requirements and exceptions remain visible rather than becoming independent quality certification.

Task/order limits: 100 tasks and unique unused slots 1–100, with no automatic order swapping or deletion UI. Activity pages contain 50 entries. Readiness evaluates every record independently of history/display limits. Private task titles/descriptions, private events and private snapshot entries are omitted for clients. Unsaved checklist edits exist only in browser memory; failed saves retain current input but reload/forced exit can lose it.

Completion records workflow closure, not payment, legal certification or independent verification of external links. Private uploads/storage, billing, AI, production email, recovery/MFA and deployment remain excluded. The feature has local verification only until this branch is pushed and its remote CI completes; no production verification is implied.
