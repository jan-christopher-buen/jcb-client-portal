-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityKind" ADD VALUE 'HANDOVER_CREATED';
ALTER TYPE "ActivityKind" ADD VALUE 'HANDOVER_EDITED';
ALTER TYPE "ActivityKind" ADD VALUE 'HANDOVER_CHECKED';
ALTER TYPE "ActivityKind" ADD VALUE 'REQUIRED_FLAG_CHANGED';
ALTER TYPE "ActivityKind" ADD VALUE 'CHANGE_CLOSED';
ALTER TYPE "ActivityKind" ADD VALUE 'PROJECT_COMPLETED';
ALTER TYPE "ActivityKind" ADD VALUE 'PROJECT_REOPENED';

-- AlterEnum
ALTER TYPE "ProjectStatus" ADD VALUE 'COMPLETED';

-- AlterEnum
ALTER TYPE "ChangeState" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "completed_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "handover_items" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "client_visible" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(6),
    "completed_by" UUID,

    CONSTRAINT "handover_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_completions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cycle" INTEGER NOT NULL,
    "actor_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "project_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handover_events" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "target_id" UUID NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "client_visible" BOOLEAN NOT NULL DEFAULT true,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handover_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "handover_items_completed_by_idx" ON "handover_items"("completed_by");

-- CreateIndex
CREATE UNIQUE INDEX "handover_items_project_id_position_key" ON "handover_items"("project_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "handover_items_id_project_id_organization_id_key" ON "handover_items"("id", "project_id", "organization_id");

-- CreateIndex
CREATE INDEX "project_completions_actor_id_idx" ON "project_completions"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_completions_project_id_cycle_key" ON "project_completions"("project_id", "cycle");

-- CreateIndex
CREATE INDEX "handover_events_project_id_created_at_id_idx" ON "handover_events"("project_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "handover_events_actor_id_idx" ON "handover_events"("actor_id");

-- AddForeignKey
ALTER TABLE "handover_items" ADD CONSTRAINT "handover_items_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "handover_items" ADD CONSTRAINT "handover_items_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_completions" ADD CONSTRAINT "project_completions_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_completions" ADD CONSTRAINT "project_completions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_events" ADD CONSTRAINT "handover_events_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "handover_events" ADD CONSTRAINT "handover_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE handover_items ADD CONSTRAINT handover_item_bounds CHECK (
 length(btrim(title)) BETWEEN 1 AND 120 AND length(btrim(description)) BETWEEN 1 AND 4000
 AND position BETWEEN 1 AND 100 AND revision>=0
 AND ((completed_at IS NULL AND completed_by IS NULL) OR (completed_at IS NOT NULL AND completed_by IS NOT NULL)));
ALTER TABLE project_completions ADD CONSTRAINT completion_bounds CHECK (cycle>0 AND jsonb_typeof(snapshot)='object'
 AND jsonb_typeof(snapshot->'milestones')='array' AND jsonb_typeof(snapshot->'deliverables')='array'
 AND jsonb_typeof(snapshot->'changes')='array' AND jsonb_typeof(snapshot->'checklist')='array');
ALTER TABLE projects ADD CONSTRAINT project_completion_state CHECK ((status::text='COMPLETED')=(completed_at IS NOT NULL));
ALTER TABLE handover_events ADD CONSTRAINT handover_reason_bound CHECK(length(reason)<=2000 AND
 (kind::text NOT IN ('HANDOVER_EDITED','HANDOVER_CHECKED','REQUIRED_FLAG_CHANGED','CHANGE_CLOSED','PROJECT_REOPENED') OR length(btrim(reason))>0));
CREATE TRIGGER completion_history_guard BEFORE UPDATE ON project_completions FOR EACH ROW EXECUTE FUNCTION jcb_deliverable_history_guard();
CREATE TRIGGER handover_event_guard BEFORE UPDATE ON handover_events FOR EACH ROW EXECUTE FUNCTION jcb_deliverable_history_guard();
CREATE FUNCTION jcb_handover_item_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.project_id,NEW.organization_id) IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.organization_id) THEN RAISE EXCEPTION 'Checklist identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER handover_item_identity BEFORE UPDATE ON handover_items FOR EACH ROW EXECUTE FUNCTION jcb_handover_item_identity();
CREATE FUNCTION jcb_completion_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status::text='COMPLETED' AND NEW.status::text NOT IN ('COMPLETED','IN_REVIEW') THEN RAISE EXCEPTION 'Completed projects require explicit reopening'; END IF;
 IF NEW.status::text='COMPLETED' AND OLD.status::text<>'COMPLETED' THEN
  IF OLD.status::text<>'IN_REVIEW' OR NOT EXISTS(SELECT 1 FROM project_completions c WHERE c.project_id=NEW.id AND c.organization_id=NEW.organization_id AND c.completed_at=NEW.completed_at) THEN RAISE EXCEPTION 'Completion requires readiness and a completion record'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER completion_transition_guard BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION jcb_completion_transition_guard();
-- Defense in depth: all workflow tables retain the same project write boundary.
-- Service writes already lock organization/actor/project in that order.
CREATE FUNCTION jcb_completed_workflow_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid uuid; current_status text;
BEGIN
 IF TG_TABLE_NAME IN ('milestones','deliverables','change_requests','handover_items') THEN pid:=NEW.project_id;
 ELSIF TG_TABLE_NAME='milestone_reviews' THEN SELECT project_id INTO pid FROM milestones WHERE id=NEW.milestone_id;
 ELSIF TG_TABLE_NAME='deliverable_versions' THEN SELECT project_id INTO pid FROM deliverables WHERE id=NEW.deliverable_id;
 ELSIF TG_TABLE_NAME='deliverable_decisions' THEN SELECT d.project_id INTO pid FROM deliverable_versions v JOIN deliverables d ON d.id=v.deliverable_id WHERE v.id=NEW.version_id;
 ELSIF TG_TABLE_NAME IN ('change_offers','change_messages') THEN SELECT project_id INTO pid FROM change_requests WHERE id=NEW.request_id;
 ELSIF TG_TABLE_NAME='change_decisions' THEN SELECT r.project_id INTO pid FROM change_offers o JOIN change_requests r ON r.id=o.request_id WHERE o.id=NEW.offer_id;
 END IF;
 SELECT status::text INTO current_status FROM projects WHERE id=pid FOR UPDATE;
 IF current_status='COMPLETED' THEN RAISE EXCEPTION 'Completed projects are read only'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER completed_milestone_guard BEFORE INSERT OR UPDATE ON milestones FOR EACH ROW EXECUTE FUNCTION jcb_completed_workflow_guard();
CREATE TRIGGER completed_review_guard BEFORE INSERT OR UPDATE ON milestone_reviews FOR EACH ROW EXECUTE FUNCTION jcb_completed_workflow_guard();
CREATE TRIGGER completed_deliverable_guard BEFORE INSERT OR UPDATE ON deliverables FOR EACH ROW EXECUTE FUNCTION jcb_completed_workflow_guard();
CREATE TRIGGER completed_version_guard BEFORE INSERT OR UPDATE ON deliverable_versions FOR EACH ROW EXECUTE FUNCTION jcb_completed_workflow_guard();
CREATE TRIGGER completed_deliverable_decision_guard BEFORE INSERT OR UPDATE ON deliverable_decisions FOR EACH ROW EXECUTE FUNCTION jcb_completed_workflow_guard();
CREATE TRIGGER completed_change_guard BEFORE INSERT OR UPDATE ON change_requests FOR EACH ROW EXECUTE FUNCTION jcb_completed_workflow_guard();
CREATE TRIGGER completed_offer_guard BEFORE INSERT OR UPDATE ON change_offers FOR EACH ROW EXECUTE FUNCTION jcb_completed_workflow_guard();
CREATE TRIGGER completed_message_guard BEFORE INSERT OR UPDATE ON change_messages FOR EACH ROW EXECUTE FUNCTION jcb_completed_workflow_guard();
CREATE TRIGGER completed_change_decision_guard BEFORE INSERT OR UPDATE ON change_decisions FOR EACH ROW EXECUTE FUNCTION jcb_completed_workflow_guard();
CREATE TRIGGER completed_checklist_guard BEFORE INSERT OR UPDATE ON handover_items FOR EACH ROW EXECUTE FUNCTION jcb_completed_workflow_guard();
