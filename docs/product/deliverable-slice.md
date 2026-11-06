# Deliverable review slice

From project overview, an owner creates a required or optional deliverable with an unused display-order slot. Saving makes an owner-only draft. The owner reviews and explicitly publishes it. Active clients see the current snapshot, text, external-link warning and version history. They accept or request changes with feedback; owners cannot make client decisions.

A requested change is resolved by a new draft and publication. Creating a draft preserves the current version and its decision. Publishing replaces the current version and starts pending review. Replacing an accepted version requires a client-visible reason. Earlier receipts apply only to their own versions. An owner can withdraw an undecided current version with a reason, then prepare a new numbered version. Historical versions and decisions remain readable.

Required-flag changes are recorded separately from snapshot content. Required status does not imply project completion or a handover gate. Milestone review remains a separate workflow. Held/cancelled projects retain read access and reject authoring, publishing and decisions; cancellation remains terminal.

Draft forms preserve input after failed submits and prevent duplicate requests while saving. Version/revision conflicts explain that the latest state must be reloaded. Editor navigation guards cover in-app navigation and supported browser refresh/close prompts; memory-only unsaved edits cannot survive every forced exit or session expiry.

Text and up to five labeled HTTPS DNS links are supported. There are no uploads, private storage, embedded previews or external fetches. All IP literals are rejected. External providers control access, and HTTPS does not guarantee safe content. Demos must use fictional public resources. Limits: 100 deliverables per project, 100 versions per deliverable, unique order slots 1–100 and 50 activity events per page. There is no automatic ordering swap or deletion UI.

Private storage/files and handover remain future slices. Project completion, billing, AI, production email, recovery/MFA and deployment are excluded.
