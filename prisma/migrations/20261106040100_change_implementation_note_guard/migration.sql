-- SQL CHECK expressions accept UNKNOWN; explicitly reject a NULL note when implemented.
ALTER TABLE change_requests ADD CONSTRAINT change_implementation_note_required
CHECK (state <> 'IMPLEMENTED' OR implementation_note IS NOT NULL);
