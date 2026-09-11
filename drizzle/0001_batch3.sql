CREATE TABLE "collection_items" (
	"collectionId" uuid NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"note" text,
	"addedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "collection_items_collectionId_owner_name_pk" PRIMARY KEY("collectionId","owner","name")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerUserId" text NOT NULL,
	"ownerHandle" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"isPublic" boolean DEFAULT true NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "collections_owner_slug_unique" UNIQUE("ownerHandle","slug")
);
--> statement-breakpoint
CREATE TABLE "package_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"userId" text NOT NULL,
	"repo" text NOT NULL,
	"ref" text,
	"subdir" text,
	"secretHash" text NOT NULL,
	"lastSyncedAt" timestamp,
	"lastResult" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "package_sources_package_unique" UNIQUE("owner","name")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"windowStart" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "package_files" ADD COLUMN "encoding" text DEFAULT 'utf8' NOT NULL;--> statement-breakpoint
ALTER TABLE "package_files" ADD COLUMN "mode" integer;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "stripeSubscriptionId" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "expiresAt" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "stripeCustomerId" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "createdAt" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collectionId_collections_id_fk" FOREIGN KEY ("collectionId") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_ownerUserId_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sources" ADD CONSTRAINT "package_sources_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "download_events_owner_name_day_idx" ON "download_events" USING btree ("owner","name","day");--> statement-breakpoint
CREATE INDEX "packages_fts_idx" ON "packages" USING gin (to_tsvector('english',
      coalesce("title", '') || ' ' ||
      coalesce("summary", '') || ' ' ||
      "name" || ' ' ||
      "owner" || ' ' ||
      coalesce("tags"::text, '')
    ));--> statement-breakpoint
CREATE INDEX "packages_owner_idx" ON "packages" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "packages_status_idx" ON "packages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "purchases_user_package_idx" ON "purchases" USING btree ("userId","packageId");--> statement-breakpoint
CREATE INDEX "purchases_payment_intent_idx" ON "purchases" USING btree ("stripePaymentIntent");--> statement-breakpoint
CREATE INDEX "reviews_owner_name_idx" ON "reviews" USING btree ("owner","name");--> statement-breakpoint
CREATE INDEX "stars_owner_name_idx" ON "stars" USING btree ("owner","name");