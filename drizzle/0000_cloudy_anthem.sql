CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"tokenHash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lastUsedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"revokedAt" timestamp,
	CONSTRAINT "api_tokens_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "download_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"runtime" text,
	"clientHash" text NOT NULL,
	"day" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "download_events_unique_per_day" UNIQUE("owner","name","clientHash","day")
);
--> statement-breakpoint
CREATE TABLE "package_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"versionId" uuid NOT NULL,
	"path" text NOT NULL,
	"size" integer NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_stats" (
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"stars" integer DEFAULT 0 NOT NULL,
	"ratingCount" integer DEFAULT 0 NOT NULL,
	"ratingSum" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "package_stats_owner_name_pk" PRIMARY KEY("owner","name")
);
--> statement-breakpoint
CREATE TABLE "package_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"packageId" uuid NOT NULL,
	"version" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"readme" text DEFAULT '' NOT NULL,
	"changelog" text,
	"publishedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "package_versions_package_version_unique" UNIQUE("packageId","version")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"license" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"runtimes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pricingModel" text NOT NULL,
	"amountCents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"entry" text NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"latestVersion" text NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"deprecationMessage" text,
	"replacementId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "packages_owner_name_unique" UNIQUE("owner","name")
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"packageId" uuid NOT NULL,
	"stripeSessionId" text,
	"stripePaymentIntent" text,
	"amountCents" integer NOT NULL,
	"currency" text,
	"receiptUrl" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_stripe_session_unique" UNIQUE("stripeSessionId")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"reporterUserId" text,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"rating" integer NOT NULL,
	"body" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_one_per_user_per_package" UNIQUE("userId","owner","name")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stars" (
	"userId" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stars_userId_owner_name_pk" PRIMARY KEY("userId","owner","name")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp,
	"image" text,
	"handle" text,
	"bio" text,
	"stripeAccountId" text,
	"stripeOnboarded" boolean DEFAULT false NOT NULL,
	"website" text,
	"isAdmin" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_files" ADD CONSTRAINT "package_files_versionId_package_versions_id_fk" FOREIGN KEY ("versionId") REFERENCES "public"."package_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_packageId_packages_id_fk" FOREIGN KEY ("packageId") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_packageId_packages_id_fk" FOREIGN KEY ("packageId") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterUserId_user_id_fk" FOREIGN KEY ("reporterUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;