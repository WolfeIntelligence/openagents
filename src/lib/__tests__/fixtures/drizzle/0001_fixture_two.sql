ALTER TABLE "widgets" ADD COLUMN "sku" text;
--> statement-breakpoint
CREATE INDEX "widgets_sku_idx" ON "widgets" USING btree ("sku");
