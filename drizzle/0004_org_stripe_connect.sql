ALTER TABLE "organizations" ADD COLUMN "stripeAccountId" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripeOnboarded" boolean DEFAULT false NOT NULL;