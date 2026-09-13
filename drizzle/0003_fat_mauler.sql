DROP INDEX "packages_fts_idx";--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "packages_fts_idx" ON "packages" USING gin (to_tsvector('english',
      coalesce("title", '') || ' ' ||
      coalesce("summary", '') || ' ' ||
      "name" || ' ' ||
      "owner" || ' ' ||
      coalesce("tags"::text, '') || ' ' ||
      coalesce("capabilities"::text, '')
    ));