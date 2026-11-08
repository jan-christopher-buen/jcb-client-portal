ALTER TABLE invitations ADD COLUMN request_key uuid,
 ADD COLUMN delivery_state text NOT NULL DEFAULT 'unconfirmed',
 ADD COLUMN send_deadline timestamptz,
 ADD COLUMN provider_message_id text;
UPDATE invitations SET delivery_state = CASE WHEN delivery_failed THEN 'failed' WHEN delivered_at IS NOT NULL THEN 'accepted' ELSE 'unconfirmed' END;
CREATE UNIQUE INDEX invitations_invited_by_request_key_key ON invitations(invited_by, request_key);
ALTER TABLE invitations ADD CONSTRAINT invitation_delivery_state CHECK (delivery_state IN ('sending','accepted','failed','unconfirmed'));
