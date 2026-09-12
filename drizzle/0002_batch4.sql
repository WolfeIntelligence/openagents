CREATE TABLE "advisories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"affectedVersions" text,
	"fixedInVersion" text,
	"createdByUserId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"withdrawnAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "download_rollups" (
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"byRuntime" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"byVersion" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "download_rollups_owner_name_day_pk" PRIMARY KEY("owner","name","day")
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"orgId" uuid NOT NULL,
	"userId" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_orgId_userId_pk" PRIMARY KEY("orgId","userId")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"displayName" text NOT NULL,
	"bio" text,
	"website" text,
	"avatarUrl" text,
	"createdByUserId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchaseId" uuid NOT NULL,
	"userId" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"sellerNote" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"resolvedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "package_versions" ADD COLUMN "riskScore" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "package_versions" ADD COLUMN "scanFlags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "ownerType" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "advisories" ADD CONSTRAINT "advisories_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_orgId_organizations_id_fk" FOREIGN KEY ("orgId") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_purchaseId_purchases_id_fk" FOREIGN KEY ("purchaseId") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;