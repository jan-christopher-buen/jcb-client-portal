-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'IN_REVIEW', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CHANGES_REQUESTED', 'WITHDRAWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityKind" ADD VALUE 'PROJECT_STATUS_CHANGED';
ALTER TYPE "ActivityKind" ADD VALUE 'MILESTONE_CREATED';
ALTER TYPE "ActivityKind" ADD VALUE 'MILESTONE_EDITED';
ALTER TYPE "ActivityKind" ADD VALUE 'MILESTONE_STARTED';
ALTER TYPE "ActivityKind" ADD VALUE 'MILESTONE_SUBMITTED';
ALTER TYPE "ActivityKind" ADD VALUE 'MILESTONE_WITHDRAWN';
ALTER TYPE "ActivityKind" ADD VALUE 'MILESTONE_REOPENED';
ALTER TYPE "ActivityKind" ADD VALUE 'MILESTONE_DECIDED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProjectStatus" ADD VALUE 'ACTIVE';
ALTER TYPE "ProjectStatus" ADD VALUE 'IN_REVIEW';
ALTER TYPE "ProjectStatus" ADD VALUE 'ON_HOLD';
ALTER TYPE "ProjectStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "lock_revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resume_status" "ProjectStatus";

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "due_date" DATE,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "current_review_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_reviews" (
    "id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision_actor_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "feedback" TEXT,
    "withdrawn_by" UUID,
    "withdrawn_at" TIMESTAMPTZ(6),
    "withdrawal_reason" TEXT,

    CONSTRAINT "milestone_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_events" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "milestone_id" UUID,
    "actor_id" UUID NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "milestones_id_project_id_organization_id_key" ON "milestones"("id", "project_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "milestones_project_id_position_key" ON "milestones"("project_id", "position");

-- CreateIndex
CREATE INDEX "milestone_reviews_submitted_by_idx" ON "milestone_reviews"("submitted_by");

-- CreateIndex
CREATE INDEX "milestone_reviews_decision_actor_id_idx" ON "milestone_reviews"("decision_actor_id");

-- CreateIndex
CREATE INDEX "milestone_reviews_withdrawn_by_idx" ON "milestone_reviews"("withdrawn_by");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_reviews_milestone_id_number_key" ON "milestone_reviews"("milestone_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_reviews_id_milestone_id_key" ON "milestone_reviews"("id", "milestone_id");

-- CreateIndex
CREATE INDEX "workflow_events_project_id_created_at_id_idx" ON "workflow_events"("project_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "workflow_events_milestone_id_idx" ON "workflow_events"("milestone_id");

-- CreateIndex
CREATE INDEX "workflow_events_actor_id_idx" ON "workflow_events"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_id_organization_id_key" ON "projects"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_current_review_id_id_fkey" FOREIGN KEY ("current_review_id", "id") REFERENCES "milestone_reviews"("id", "milestone_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "milestone_reviews" ADD CONSTRAINT "milestone_reviews_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_reviews" ADD CONSTRAINT "milestone_reviews_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_reviews" ADD CONSTRAINT "milestone_reviews_decision_actor_id_fkey" FOREIGN KEY ("decision_actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_reviews" ADD CONSTRAINT "milestone_reviews_withdrawn_by_fkey" FOREIGN KEY ("withdrawn_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_milestone_id_project_id_organization_id_fkey" FOREIGN KEY ("milestone_id", "project_id", "organization_id") REFERENCES "milestones"("id", "project_id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Date-only, bounded metadata and one pending round per milestone.
ALTER TABLE projects ADD CONSTRAINT project_resume_state CHECK (
 (status::text = 'ON_HOLD' AND resume_status IS NOT NULL AND resume_status::text IN ('PLANNED','ACTIVE','IN_REVIEW'))
 OR (status::text <> 'ON_HOLD' AND resume_status IS NULL));
ALTER TABLE milestones ADD CONSTRAINT milestone_bounds CHECK (
 length(btrim(title)) BETWEEN 1 AND 120 AND length(btrim(description)) BETWEEN 1 AND 12000
 AND position BETWEEN 1 AND 100 AND revision >= 0
 AND (due_date IS NULL OR due_date BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'));
ALTER TABLE milestone_reviews ADD CONSTRAINT review_bounds CHECK (
 number BETWEEN 1 AND 100 AND length(btrim(title)) BETWEEN 1 AND 120
 AND length(btrim(description)) BETWEEN 1 AND 12000
 AND (feedback IS NULL OR length(feedback) <= 4000)
 AND (
 (status = 'PENDING' AND decision_actor_id IS NULL AND decided_at IS NULL AND feedback IS NULL AND withdrawn_by IS NULL AND withdrawn_at IS NULL AND withdrawal_reason IS NULL)
 OR (status IN ('ACCEPTED','CHANGES_REQUESTED') AND decision_actor_id IS NOT NULL AND decided_at IS NOT NULL AND feedback IS NOT NULL AND (status <> 'CHANGES_REQUESTED' OR length(btrim(feedback)) > 0) AND withdrawn_by IS NULL AND withdrawn_at IS NULL AND withdrawal_reason IS NULL)
 OR (status = 'WITHDRAWN' AND decision_actor_id IS NULL AND decided_at IS NULL AND feedback IS NULL AND withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL AND length(btrim(withdrawal_reason)) BETWEEN 1 AND 2000)
 ));
CREATE UNIQUE INDEX milestone_one_pending_review ON milestone_reviews(milestone_id) WHERE status = 'PENDING';
CREATE FUNCTION jcb_review_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status <> 'PENDING' OR ROW(NEW.id,NEW.milestone_id,NEW.number,NEW.title,NEW.description,NEW.submitted_by,NEW.submitted_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.milestone_id,OLD.number,OLD.title,OLD.description,OLD.submitted_by,OLD.submitted_at)
 THEN RAISE EXCEPTION 'Review snapshots and terminal receipts are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_snapshot_guard BEFORE UPDATE ON milestone_reviews FOR EACH ROW EXECUTE FUNCTION jcb_review_snapshot_guard();
CREATE FUNCTION jcb_milestone_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.project_id,NEW.organization_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.organization_id,OLD.created_at)
 THEN RAISE EXCEPTION 'Milestone identity is immutable'; END IF;
 IF OLD.status IN ('IN_REVIEW','ACCEPTED') AND ROW(NEW.title,NEW.description,NEW.due_date,NEW.required,NEW.position)
 IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.due_date,OLD.required,OLD.position)
 THEN RAISE EXCEPTION 'Withdraw or reopen before editing'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER milestone_snapshot_guard BEFORE UPDATE ON milestones FOR EACH ROW EXECUTE FUNCTION jcb_milestone_snapshot_guard();
CREATE FUNCTION jcb_workflow_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Workflow events are immutable'; END $$;
CREATE TRIGGER workflow_event_guard BEFORE UPDATE ON workflow_events FOR EACH ROW EXECUTE FUNCTION jcb_workflow_event_guard();
ALTER TABLE workflow_events ADD CONSTRAINT workflow_event_reason_bound CHECK (length(reason) <= 2000);
