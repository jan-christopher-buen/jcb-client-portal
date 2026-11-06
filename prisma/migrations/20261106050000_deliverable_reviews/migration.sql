-- CreateEnum
CREATE TYPE "DeliverableVersionState" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DeliverableOutcome" AS ENUM ('ACCEPTED', 'CHANGES_REQUESTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityKind" ADD VALUE 'DELIVERABLE_CREATED';
ALTER TYPE "ActivityKind" ADD VALUE 'DELIVERABLE_METADATA_CHANGED';
ALTER TYPE "ActivityKind" ADD VALUE 'DELIVERABLE_PUBLISHED';
ALTER TYPE "ActivityKind" ADD VALUE 'DELIVERABLE_REPLACED';
ALTER TYPE "ActivityKind" ADD VALUE 'DELIVERABLE_WITHDRAWN';
ALTER TYPE "ActivityKind" ADD VALUE 'DELIVERABLE_DECIDED';

-- CreateTable
CREATE TABLE "deliverables" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "current_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverable_versions" (
    "id" UUID NOT NULL,
    "deliverable_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "state" "DeliverableVersionState" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "links" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "publication_reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliverable_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverable_decisions" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "outcome" "DeliverableOutcome" NOT NULL,
    "feedback" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliverable_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverable_events" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deliverable_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "version_number" INTEGER,
    "kind" "ActivityKind" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "required_before" BOOLEAN,
    "required_after" BOOLEAN,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliverable_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deliverables_id_project_id_organization_id_key" ON "deliverables"("id", "project_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliverables_project_id_position_key" ON "deliverables"("project_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "deliverable_versions_id_deliverable_id_key" ON "deliverable_versions"("id", "deliverable_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliverable_versions_deliverable_id_number_key" ON "deliverable_versions"("deliverable_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "deliverable_decisions_version_id_key" ON "deliverable_decisions"("version_id");

-- CreateIndex
CREATE INDEX "deliverable_decisions_actor_id_idx" ON "deliverable_decisions"("actor_id");

-- CreateIndex
CREATE INDEX "deliverable_events_deliverable_id_created_at_id_idx" ON "deliverable_events"("deliverable_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "deliverable_events_project_id_created_at_id_idx" ON "deliverable_events"("project_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "deliverable_events_actor_id_idx" ON "deliverable_events"("actor_id");

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_current_version_id_id_fkey" FOREIGN KEY ("current_version_id", "id") REFERENCES "deliverable_versions"("id", "deliverable_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_deliverable_id_fkey" FOREIGN KEY ("deliverable_id") REFERENCES "deliverables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_decisions" ADD CONSTRAINT "deliverable_decisions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "deliverable_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_decisions" ADD CONSTRAINT "deliverable_decisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_events" ADD CONSTRAINT "deliverable_events_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "deliverable_events" ADD CONSTRAINT "deliverable_events_deliverable_id_project_id_organization__fkey" FOREIGN KEY ("deliverable_id", "project_id", "organization_id") REFERENCES "deliverables"("id", "project_id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "deliverable_events" ADD CONSTRAINT "deliverable_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX deliverable_one_draft ON deliverable_versions(deliverable_id) WHERE state='DRAFT';
CREATE UNIQUE INDEX deliverable_one_published ON deliverable_versions(deliverable_id) WHERE state='PUBLISHED';
ALTER TABLE deliverables ADD CONSTRAINT deliverable_bounds CHECK(position BETWEEN 1 AND 100 AND revision>=0);
ALTER TABLE deliverable_versions ADD CONSTRAINT deliverable_version_bounds CHECK(number BETWEEN 1 AND 100 AND revision>=0
 AND length(btrim(title)) BETWEEN 1 AND 120 AND length(btrim(description)) BETWEEN 1 AND 8000 AND length(publication_reason)<=2000
 AND ((state='DRAFT' AND published_at IS NULL AND publication_reason='') OR (state<>'DRAFT' AND published_at IS NOT NULL)));
CREATE FUNCTION jcb_deliverable_links_valid(links jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb;
BEGIN
 IF jsonb_typeof(links)<>'array' OR jsonb_array_length(links)>5 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(links) LOOP
  IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'url') IS DISTINCT FROM 'string'
   OR length(btrim(item->>'label')) NOT BETWEEN 1 AND 120 OR length(item->>'url') NOT BETWEEN 1 AND 1000
   OR (item-'label'-'url')<>'{}'::jsonb OR (item->>'url') !~ '^https://' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
ALTER TABLE deliverable_versions ADD CONSTRAINT deliverable_links_shape CHECK(jcb_deliverable_links_valid(links));
ALTER TABLE deliverable_decisions ADD CONSTRAINT deliverable_feedback_bounds CHECK(length(feedback)<=4000 AND (outcome<>'CHANGES_REQUESTED' OR length(btrim(feedback))>0));
ALTER TABLE deliverable_events ADD CONSTRAINT deliverable_event_bounds CHECK(length(reason)<=2000 AND (version_number IS NULL OR version_number BETWEEN 1 AND 100)
 AND (kind::text NOT IN ('DELIVERABLE_WITHDRAWN') OR length(btrim(reason))>0));
CREATE FUNCTION jcb_deliverable_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.deliverable_id,NEW.number,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.deliverable_id,OLD.number,OLD.created_at) THEN RAISE EXCEPTION 'Version identity is immutable'; END IF;
  IF OLD.state<>'DRAFT' AND ROW(NEW.title,NEW.description,NEW.links,NEW.revision,NEW.published_at,NEW.publication_reason)
   IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.links,OLD.revision,OLD.published_at,OLD.publication_reason) THEN RAISE EXCEPTION 'Published deliverable is immutable'; END IF;
  IF (OLD.state='DRAFT' AND NEW.state NOT IN ('DRAFT','PUBLISHED')) OR (OLD.state='PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','SUPERSEDED','WITHDRAWN')) OR (OLD.state IN ('SUPERSEDED','WITHDRAWN') AND NEW.state<>OLD.state) THEN RAISE EXCEPTION 'Invalid deliverable transition'; END IF;
  IF NEW.state='WITHDRAWN' AND OLD.state<>'WITHDRAWN' AND EXISTS(SELECT 1 FROM deliverable_decisions WHERE version_id=OLD.id) THEN RAISE EXCEPTION 'Decided versions cannot be withdrawn'; END IF;
  IF NEW.state='PUBLISHED' AND OLD.state='DRAFT' AND EXISTS(
   SELECT 1 FROM deliverables d JOIN deliverable_decisions r ON r.version_id=d.current_version_id WHERE d.id=NEW.deliverable_id AND r.outcome='ACCEPTED'
  ) AND length(btrim(NEW.publication_reason))=0 THEN RAISE EXCEPTION 'Accepted replacement requires a reason'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deliverable_version_guard BEFORE UPDATE ON deliverable_versions FOR EACH ROW EXECUTE FUNCTION jcb_deliverable_version_guard();
CREATE FUNCTION jcb_deliverable_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.project_id,NEW.organization_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.organization_id,OLD.created_at) THEN RAISE EXCEPTION 'Deliverable identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deliverable_identity_guard BEFORE UPDATE ON deliverables FOR EACH ROW EXECUTE FUNCTION jcb_deliverable_identity_guard();
CREATE FUNCTION jcb_deliverable_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM deliverable_versions v JOIN deliverables d ON d.id=v.deliverable_id JOIN projects p ON p.id=d.project_id AND p.organization_id=d.organization_id
 JOIN organizations o ON o.id=d.organization_id JOIN memberships m ON m.organization_id=o.id AND m.user_id=NEW.actor_id JOIN users u ON u.id=NEW.actor_id
 WHERE v.id=NEW.version_id AND v.state='PUBLISHED' AND d.current_version_id=v.id AND p.status::text NOT IN ('ON_HOLD','CANCELLED')
 AND o.archived_at IS NULL AND m.revoked_at IS NULL AND u.disabled_at IS NULL AND u.role='CLIENT') THEN RAISE EXCEPTION 'Decision requires current authorized deliverable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deliverable_decision_guard BEFORE INSERT ON deliverable_decisions FOR EACH ROW EXECUTE FUNCTION jcb_deliverable_decision_guard();
CREATE FUNCTION jcb_deliverable_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Deliverable history is immutable'; END $$;
CREATE TRIGGER deliverable_decision_update_guard BEFORE UPDATE ON deliverable_decisions FOR EACH ROW EXECUTE FUNCTION jcb_deliverable_history_guard();
CREATE TRIGGER deliverable_event_guard BEFORE UPDATE ON deliverable_events FOR EACH ROW EXECUTE FUNCTION jcb_deliverable_history_guard();
