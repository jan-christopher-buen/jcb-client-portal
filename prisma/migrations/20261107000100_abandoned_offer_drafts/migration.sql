ALTER TYPE "ChangeOfferState" ADD VALUE 'ABANDONED';
ALTER TABLE change_offers DROP CONSTRAINT change_offer_bounds;
ALTER TABLE change_offers ADD CONSTRAINT change_offer_bounds CHECK (
 number BETWEEN 1 AND 100 AND revision >= 0 AND length(btrim(scope)) BETWEEN 1 AND 8000
 AND length(exclusions) <= 4000 AND length(btrim(schedule_impact)) BETWEEN 1 AND 2000
 AND adjustment_minor BETWEEN -100000000000000000 AND 100000000000000000
 AND ((state::text IN ('DRAFT','ABANDONED') AND published_at IS NULL) OR (state::text NOT IN ('DRAFT','ABANDONED') AND published_at IS NOT NULL)));
CREATE OR REPLACE FUNCTION jcb_change_offer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM change_requests WHERE id=NEW.request_id AND state::text='CLOSED') THEN RAISE EXCEPTION 'Closed changes are locked'; END IF;
 IF EXISTS(SELECT 1 FROM change_requests WHERE id=NEW.request_id AND state IN ('APPROVED','IMPLEMENTED')) THEN
  IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Approved changes are locked'; END IF;
  IF NOT (OLD.state='DRAFT' AND NEW.state::text='ABANDONED') THEN RAISE EXCEPTION 'Approved changes are locked'; END IF;
 END IF;
 IF TG_OP = 'UPDATE' THEN
  IF ROW(NEW.id,NEW.request_id,NEW.number,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.request_id,OLD.number,OLD.created_at) THEN RAISE EXCEPTION 'Offer identity is immutable'; END IF;
  IF (OLD.state <> 'DRAFT' OR NEW.state::text='ABANDONED') AND ROW(NEW.scope,NEW.exclusions,NEW.adjustment_minor,NEW.schedule_impact,NEW.published_at,NEW.revision)
   IS DISTINCT FROM ROW(OLD.scope,OLD.exclusions,OLD.adjustment_minor,OLD.schedule_impact,OLD.published_at,OLD.revision) THEN RAISE EXCEPTION 'Published or abandoned offer is immutable'; END IF;
  IF (OLD.state='DRAFT' AND NEW.state::text NOT IN ('DRAFT','PUBLISHED','ABANDONED')) OR (OLD.state='PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','SUPERSEDED','APPROVED','DECLINED'))
   OR (OLD.state::text IN ('SUPERSEDED','APPROVED','DECLINED','ABANDONED') AND NEW.state <> OLD.state) THEN RAISE EXCEPTION 'Invalid offer transition'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION jcb_change_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.project_id,NEW.organization_id,NEW.created_by,NEW.title,NEW.requested_change,NEW.business_context,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.organization_id,OLD.created_by,OLD.title,OLD.requested_change,OLD.business_context,OLD.created_at) THEN RAISE EXCEPTION 'Original request is immutable'; END IF;
 IF OLD.state='IMPLEMENTED' AND ROW(NEW.state,NEW.implementation_note,NEW.implemented_by,NEW.implemented_at)
 IS DISTINCT FROM ROW(OLD.state,OLD.implementation_note,OLD.implemented_by,OLD.implemented_at) THEN RAISE EXCEPTION 'Implementation history is immutable'; END IF;
 IF OLD.state='APPROVED' AND NEW.state NOT IN ('APPROVED','IMPLEMENTED') THEN RAISE EXCEPTION 'Approved change is locked'; END IF;
 IF OLD.state::text='CLOSED' AND NEW.state<>OLD.state THEN RAISE EXCEPTION 'Closed changes are locked'; END IF;
 RETURN NEW;
END $$;
