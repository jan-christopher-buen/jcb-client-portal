-- CreateEnum
CREATE TYPE "ProposalState" AS ENUM ('DRAFT', 'SENT', 'SUPERSEDED', 'APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "DecisionOutcome" AS ENUM ('APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityKind" ADD VALUE 'PROPOSAL_CREATED';
ALTER TYPE "ActivityKind" ADD VALUE 'PROPOSAL_SENT';
ALTER TYPE "ActivityKind" ADD VALUE 'PROPOSAL_SUPERSEDED';
ALTER TYPE "ActivityKind" ADD VALUE 'PROPOSAL_DECIDED';
ALTER TYPE "ActivityKind" ADD VALUE 'PROJECT_CREATED';

-- CreateTable
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "published_version_id" UUID,
    "lock_revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_versions" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "state" "ProposalState" NOT NULL DEFAULT 'DRAFT',
    "edit_revision" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "exclusions" TEXT NOT NULL,
    "delivery_assumptions" TEXT NOT NULL,
    "internal_notes" TEXT NOT NULL DEFAULT '',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
    "items" JSONB NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_decisions" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "outcome" "DecisionOutcome" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "approved_version_id" UUID NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposals_organization_id_created_at_id_idx" ON "proposals"("organization_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_id_organization_id_key" ON "proposals"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_versions_proposal_id_number_key" ON "proposal_versions"("proposal_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_versions_id_proposal_id_organization_id_key" ON "proposal_versions"("id", "proposal_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_decisions_version_id_key" ON "proposal_decisions"("version_id");

-- CreateIndex
CREATE INDEX "proposal_decisions_actor_id_idx" ON "proposal_decisions"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_proposal_id_key" ON "projects"("proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_approved_version_id_key" ON "projects"("approved_version_id");

-- CreateIndex
CREATE INDEX "projects_organization_id_created_at_id_idx" ON "projects"("organization_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_published_version_id_id_organization_id_fkey" FOREIGN KEY ("published_version_id", "id", "organization_id") REFERENCES "proposal_versions"("id", "proposal_id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_proposal_id_organization_id_fkey" FOREIGN KEY ("proposal_id", "organization_id") REFERENCES "proposals"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "proposal_decisions" ADD CONSTRAINT "proposal_decisions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "proposal_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_decisions" ADD CONSTRAINT "proposal_decisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_proposal_id_organization_id_fkey" FOREIGN KEY ("proposal_id", "organization_id") REFERENCES "proposals"("id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_approved_version_id_proposal_id_organization_id_fkey" FOREIGN KEY ("approved_version_id", "proposal_id", "organization_id") REFERENCES "proposal_versions"("id", "proposal_id", "organization_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_approved_version_id_fkey" FOREIGN KEY ("approved_version_id") REFERENCES "proposal_decisions"("version_id") ON DELETE RESTRICT ON UPDATE NO ACTION;


-- One editable draft and one undecided published version per proposal.
CREATE UNIQUE INDEX proposal_one_draft ON proposal_versions(proposal_id) WHERE state = 'DRAFT';
CREATE UNIQUE INDEX proposal_one_sent ON proposal_versions(proposal_id) WHERE state = 'SENT';
ALTER TABLE proposal_versions ADD CONSTRAINT proposal_version_bounds CHECK
  (number BETWEEN 1 AND 100 AND edit_revision >= 0 AND currency = 'PHP'
   AND length(btrim(title)) BETWEEN 1 AND 120 AND length(btrim(scope)) BETWEEN 1 AND 12000
   AND length(exclusions) <= 12000 AND length(delivery_assumptions) <= 12000 AND length(internal_notes) <= 4000
   AND ((state = 'DRAFT' AND sent_at IS NULL) OR (state <> 'DRAFT' AND sent_at IS NOT NULL)));

-- Array order is line-item order. Prices are canonical decimal-string centavos.
CREATE FUNCTION jcb_valid_proposal_money(items jsonb, total bigint) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; quantity numeric; price numeric; computed numeric := 0;
BEGIN
 IF jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  IF jsonb_typeof(item) <> 'object'
   OR jsonb_typeof(item->'description') IS DISTINCT FROM 'string'
   OR length(btrim(item->>'description')) NOT BETWEEN 1 AND 500
   OR jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number'
   OR jsonb_typeof(item->'unitPriceMinor') IS DISTINCT FROM 'string'
   OR (item - 'description' - 'quantity' - 'unitPriceMinor') <> '{}'::jsonb
   OR (item->>'unitPriceMinor') !~ '^(0|[1-9][0-9]{0,12})$' THEN RETURN false; END IF;
  quantity := (item->>'quantity')::numeric; price := (item->>'unitPriceMinor')::numeric;
  IF quantity <> trunc(quantity) OR quantity NOT BETWEEN 1 AND 10000 OR price NOT BETWEEN 0 AND 1000000000000 THEN RETURN false; END IF;
  computed := computed + quantity * price;
 END LOOP;
 RETURN computed BETWEEN 0 AND 100000000000000000 AND computed = total;
END $$;
ALTER TABLE proposal_versions ADD CONSTRAINT proposal_money_exact CHECK (jcb_valid_proposal_money(items, total_minor));

CREATE FUNCTION jcb_protect_proposal_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF EXISTS (SELECT 1 FROM proposal_versions WHERE proposal_id = NEW.proposal_id AND state = 'APPROVED') THEN RAISE EXCEPTION 'Approved proposal is locked'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id, NEW.proposal_id, NEW.organization_id, NEW.number, NEW.created_at) IS DISTINCT FROM ROW(OLD.id, OLD.proposal_id, OLD.organization_id, OLD.number, OLD.created_at) THEN RAISE EXCEPTION 'Version identity is immutable'; END IF;
 IF OLD.state <> 'DRAFT' AND ROW(NEW.title, NEW.scope, NEW.exclusions, NEW.delivery_assumptions, NEW.internal_notes, NEW.currency, NEW.items, NEW.total_minor, NEW.sent_at, NEW.edit_revision)
  IS DISTINCT FROM ROW(OLD.title, OLD.scope, OLD.exclusions, OLD.delivery_assumptions, OLD.internal_notes, OLD.currency, OLD.items, OLD.total_minor, OLD.sent_at, OLD.edit_revision) THEN RAISE EXCEPTION 'Published snapshot is immutable'; END IF;
 IF (OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT', 'SENT'))
  OR (OLD.state = 'SENT' AND NEW.state NOT IN ('SENT', 'SUPERSEDED', 'APPROVED', 'DECLINED'))
  OR (OLD.state IN ('SUPERSEDED', 'APPROVED', 'DECLINED') AND NEW.state <> OLD.state) THEN RAISE EXCEPTION 'Invalid proposal transition'; END IF;
 IF OLD.state = 'DRAFT' AND EXISTS (SELECT 1 FROM proposal_versions WHERE proposal_id = OLD.proposal_id AND state = 'APPROVED') THEN RAISE EXCEPTION 'Approved proposal is locked'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposal_snapshot_guard BEFORE INSERT OR UPDATE ON proposal_versions FOR EACH ROW EXECUTE FUNCTION jcb_protect_proposal_snapshot();

CREATE FUNCTION jcb_protect_proposal_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Decision receipts are immutable'; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM proposal_versions v JOIN proposals p ON p.id = v.proposal_id
  JOIN organizations o ON o.id = v.organization_id
  JOIN memberships m ON m.organization_id = v.organization_id AND m.user_id = NEW.actor_id
  JOIN users u ON u.id = NEW.actor_id
  WHERE v.id = NEW.version_id AND p.published_version_id = v.id AND v.state::text = NEW.outcome::text
   AND m.revoked_at IS NULL AND o.archived_at IS NULL AND u.disabled_at IS NULL AND u.role = 'CLIENT'
 ) THEN RAISE EXCEPTION 'Decision does not match an authorized current snapshot'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposal_decision_guard BEFORE INSERT OR UPDATE ON proposal_decisions FOR EACH ROW EXECUTE FUNCTION jcb_protect_proposal_decision();

CREATE FUNCTION jcb_check_project_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM proposal_versions v JOIN proposal_decisions d ON d.version_id = v.id
 WHERE v.id = NEW.approved_version_id AND v.proposal_id = NEW.proposal_id AND v.organization_id = NEW.organization_id AND v.state = 'APPROVED' AND d.outcome = 'APPROVED') THEN RAISE EXCEPTION 'Project requires matching approved snapshot'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_approval_guard BEFORE INSERT OR UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION jcb_check_project_approval();
