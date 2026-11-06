-- CreateEnum
CREATE TYPE "ChangeState" AS ENUM ('OPEN', 'NEEDS_CLARIFICATION', 'OFFERED', 'APPROVED', 'DECLINED', 'IMPLEMENTED');

-- CreateEnum
CREATE TYPE "ChangeOfferState" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ChangeMessageKind" AS ENUM ('CLARIFICATION', 'RESPONSE', 'OWNER_NOTE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityKind" ADD VALUE 'CHANGE_REQUESTED';
ALTER TYPE "ActivityKind" ADD VALUE 'CHANGE_CLARIFICATION';
ALTER TYPE "ActivityKind" ADD VALUE 'CHANGE_RESPONDED';
ALTER TYPE "ActivityKind" ADD VALUE 'CHANGE_OFFER_PUBLISHED';
ALTER TYPE "ActivityKind" ADD VALUE 'CHANGE_OFFER_SUPERSEDED';
ALTER TYPE "ActivityKind" ADD VALUE 'CHANGE_DECIDED';
ALTER TYPE "ActivityKind" ADD VALUE 'CHANGE_IMPLEMENTED';

-- CreateTable
CREATE TABLE "change_requests" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "requested_change" TEXT NOT NULL,
    "business_context" TEXT NOT NULL,
    "state" "ChangeState" NOT NULL DEFAULT 'OPEN',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "published_offer_id" UUID,
    "implementation_note" TEXT,
    "implemented_by" UUID,
    "implemented_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_offers" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "state" "ChangeOfferState" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "scope" TEXT NOT NULL,
    "exclusions" TEXT NOT NULL,
    "adjustment_minor" BIGINT NOT NULL,
    "schedule_impact" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_decisions" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "outcome" "DecisionOutcome" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_messages" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "kind" "ChangeMessageKind" NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "change_requests_project_id_created_at_id_idx" ON "change_requests"("project_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "change_requests_created_by_idx" ON "change_requests"("created_by");

-- CreateIndex
CREATE INDEX "change_requests_implemented_by_idx" ON "change_requests"("implemented_by");

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_id_project_id_organization_id_key" ON "change_requests"("id", "project_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "change_offers_request_id_number_key" ON "change_offers"("request_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "change_offers_id_request_id_key" ON "change_offers"("id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "change_decisions_offer_id_key" ON "change_decisions"("offer_id");

-- CreateIndex
CREATE INDEX "change_decisions_actor_id_idx" ON "change_decisions"("actor_id");

-- CreateIndex
CREATE INDEX "change_messages_request_id_created_at_id_idx" ON "change_messages"("request_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "change_messages_actor_id_idx" ON "change_messages"("actor_id");

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_published_offer_id_id_fkey" FOREIGN KEY ("published_offer_id", "id") REFERENCES "change_offers"("id", "request_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_implemented_by_fkey" FOREIGN KEY ("implemented_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_offers" ADD CONSTRAINT "change_offers_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_decisions" ADD CONSTRAINT "change_decisions_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "change_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_decisions" ADD CONSTRAINT "change_decisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_messages" ADD CONSTRAINT "change_messages_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_messages" ADD CONSTRAINT "change_messages_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutable snapshots, receipts and precise, bounded signed centavos.
CREATE UNIQUE INDEX change_one_draft ON change_offers(request_id) WHERE state = 'DRAFT';
CREATE UNIQUE INDEX change_one_pending_offer ON change_offers(request_id) WHERE state = 'PUBLISHED';
CREATE UNIQUE INDEX change_one_approved_offer ON change_offers(request_id) WHERE state = 'APPROVED';
ALTER TABLE change_requests ADD CONSTRAINT change_request_bounds CHECK (
 length(btrim(title)) BETWEEN 1 AND 120 AND length(btrim(requested_change)) BETWEEN 1 AND 8000
 AND length(btrim(business_context)) BETWEEN 1 AND 4000 AND revision >= 0
 AND ((state = 'IMPLEMENTED' AND implemented_by IS NOT NULL AND implemented_at IS NOT NULL AND length(btrim(implementation_note)) BETWEEN 1 AND 2000)
 OR (state <> 'IMPLEMENTED' AND implemented_by IS NULL AND implemented_at IS NULL AND implementation_note IS NULL)));
ALTER TABLE change_offers ADD CONSTRAINT change_offer_bounds CHECK (
 number BETWEEN 1 AND 100 AND revision >= 0 AND length(btrim(scope)) BETWEEN 1 AND 8000
 AND length(exclusions) <= 4000 AND length(btrim(schedule_impact)) BETWEEN 1 AND 2000
 AND adjustment_minor BETWEEN -100000000000000000 AND 100000000000000000
 AND ((state = 'DRAFT' AND published_at IS NULL) OR (state <> 'DRAFT' AND published_at IS NOT NULL)));
ALTER TABLE change_messages ADD CONSTRAINT change_message_bounds CHECK (length(btrim(body)) BETWEEN 1 AND 4000);
CREATE FUNCTION jcb_change_offer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM change_requests WHERE id=NEW.request_id AND state IN ('APPROVED','IMPLEMENTED')) THEN RAISE EXCEPTION 'Approved changes are locked'; END IF;
 IF TG_OP = 'UPDATE' THEN
  IF ROW(NEW.id,NEW.request_id,NEW.number,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.request_id,OLD.number,OLD.created_at) THEN RAISE EXCEPTION 'Offer identity is immutable'; END IF;
  IF OLD.state <> 'DRAFT' AND ROW(NEW.scope,NEW.exclusions,NEW.adjustment_minor,NEW.schedule_impact,NEW.published_at,NEW.revision)
   IS DISTINCT FROM ROW(OLD.scope,OLD.exclusions,OLD.adjustment_minor,OLD.schedule_impact,OLD.published_at,OLD.revision) THEN RAISE EXCEPTION 'Published offer is immutable'; END IF;
  IF (OLD.state='DRAFT' AND NEW.state NOT IN ('DRAFT','PUBLISHED')) OR (OLD.state='PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','SUPERSEDED','APPROVED','DECLINED'))
   OR (OLD.state IN ('SUPERSEDED','APPROVED','DECLINED') AND NEW.state <> OLD.state) THEN RAISE EXCEPTION 'Invalid offer transition'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER change_offer_guard BEFORE INSERT OR UPDATE ON change_offers FOR EACH ROW EXECUTE FUNCTION jcb_change_offer_guard();
CREATE FUNCTION jcb_change_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.project_id,NEW.organization_id,NEW.created_by,NEW.title,NEW.requested_change,NEW.business_context,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.organization_id,OLD.created_by,OLD.title,OLD.requested_change,OLD.business_context,OLD.created_at) THEN RAISE EXCEPTION 'Original request is immutable'; END IF;
 IF OLD.state='IMPLEMENTED' AND ROW(NEW.state,NEW.implementation_note,NEW.implemented_by,NEW.implemented_at)
 IS DISTINCT FROM ROW(OLD.state,OLD.implementation_note,OLD.implemented_by,OLD.implemented_at) THEN RAISE EXCEPTION 'Implementation history is immutable'; END IF;
 IF OLD.state='APPROVED' AND NEW.state NOT IN ('APPROVED','IMPLEMENTED') THEN RAISE EXCEPTION 'Approved change is locked'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER change_request_guard BEFORE UPDATE ON change_requests FOR EACH ROW EXECUTE FUNCTION jcb_change_request_guard();
CREATE FUNCTION jcb_change_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Change discussion and decisions are immutable'; END $$;
CREATE TRIGGER change_message_guard BEFORE UPDATE ON change_messages FOR EACH ROW EXECUTE FUNCTION jcb_change_history_guard();
CREATE TRIGGER change_decision_update_guard BEFORE UPDATE ON change_decisions FOR EACH ROW EXECUTE FUNCTION jcb_change_history_guard();
CREATE FUNCTION jcb_change_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_project_id uuid; original numeric; adjustment numeric; previous numeric;
BEGIN
 SELECT p.id,v.total_minor,o.adjustment_minor INTO target_project_id,original,adjustment FROM change_offers o
 JOIN change_requests r ON r.id=o.request_id JOIN projects p ON p.id=r.project_id AND p.organization_id=r.organization_id
 JOIN proposal_versions v ON v.id=p.approved_version_id
 JOIN organizations org ON org.id=p.organization_id JOIN memberships m ON m.organization_id=org.id AND m.user_id=NEW.actor_id
 JOIN users u ON u.id=NEW.actor_id
 WHERE o.id=NEW.offer_id AND r.published_offer_id=o.id AND r.state='OFFERED' AND o.state::text=NEW.outcome::text
 AND p.status::text NOT IN ('ON_HOLD','CANCELLED') AND org.archived_at IS NULL AND m.revoked_at IS NULL AND u.disabled_at IS NULL AND u.role='CLIENT';
 IF target_project_id IS NULL THEN RAISE EXCEPTION 'Decision requires an authorized current offer'; END IF;
 PERFORM id FROM projects WHERE id=target_project_id FOR UPDATE;
 IF NEW.outcome='APPROVED' THEN
  SELECT coalesce(sum(o.adjustment_minor::numeric),0) INTO previous FROM change_decisions d
  JOIN change_offers o ON o.id=d.offer_id JOIN change_requests r ON r.id=o.request_id WHERE r.project_id=target_project_id AND d.outcome='APPROVED';
  IF original+previous+adjustment NOT BETWEEN 0 AND 100000000000000000 THEN RAISE EXCEPTION 'Revised agreement outside bounds'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER change_decision_guard BEFORE INSERT ON change_decisions FOR EACH ROW EXECUTE FUNCTION jcb_change_decision_guard();
