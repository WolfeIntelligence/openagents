// Publishing pipeline: takes raw uploaded files, validates openagent.yaml, and writes
// package + version + file rows to Postgres. Requires the DB to be enabled — callers
// (the publish route) should check isDbEnabled() first and return 503 otherwise.

import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packageFiles, packages, packageVersions, users } from "@/lib/db/schema";
import { ManifestError, parseManifest, validateManifestFiles } from "@/lib/manifest";

export interface PublishFile {
  path: string;
  content: string;
}

export interface PublishArgs {
  /** The authenticated caller's handle. Must match manifest.owner. */
  userHandle: string;
  files: PublishFile[];
}

export interface PublishResult {
  id: string;
  version: string;
}

/** Thrown for any publish failure; `status` is the HTTP status the route should return. */
export class PublishError extends Error {
  status: number;
  errors: string[];

  constructor(status: number, errors: string[]) {
    super(errors[0] ?? "publish failed");
    this.name = "PublishError";
    this.status = status;
    this.errors = errors;
  }
}

export async function publishPackage({ userHandle, files }: PublishArgs): Promise<PublishResult> {
  const db = getDb();
  if (!db) throw new PublishError(503, ["database not configured"]);

  const manifestFile = files.find((f) => f.path === "openagent.yaml");
  if (!manifestFile) throw new PublishError(400, ["missing openagent.yaml"]);

  let manifest;
  try {
    manifest = parseManifest(manifestFile.content);
  } catch (err) {
    if (err instanceof ManifestError) throw new PublishError(400, err.issues);
    throw new PublishError(400, [err instanceof Error ? err.message : String(err)]);
  }

  if (manifest.owner !== userHandle) {
    throw new PublishError(400, [
      `manifest owner "${manifest.owner}" does not match your handle "${userHandle}"`,
    ]);
  }

  if (manifest.pricing.model !== "free") {
    const [seller] = await db
      .select({ stripeOnboarded: users.stripeOnboarded })
      .from(users)
      .where(eq(users.handle, userHandle))
      .limit(1);
    if (!seller?.stripeOnboarded) {
      throw new PublishError(400, [
        "Connect Stripe payouts before publishing a paid package (Settings → Payouts).",
      ]);
    }
  }

  const fileErrors = validateManifestFiles(
    manifest,
    files.map((f) => f.path)
  );
  if (fileErrors.length) throw new PublishError(400, fileErrors);

  const readmeFile = files.find((f) => f.path.toLowerCase() === "readme.md");

  const packageValues = {
    kind: manifest.kind,
    title: manifest.title,
    summary: manifest.summary,
    license: manifest.license,
    tags: manifest.tags,
    runtimes: manifest.runtimes,
    pricingModel: manifest.pricing.model,
    amountCents: manifest.pricing.amountCents,
    currency: manifest.pricing.currency,
    entry: manifest.entry,
    latestVersion: manifest.version,
  };

  // neon-http has no transactions; these run sequentially and are accepted as such.
  const [existing] = await db
    .select({ id: packages.id })
    .from(packages)
    .where(and(eq(packages.owner, manifest.owner), eq(packages.name, manifest.name)))
    .limit(1);

  let packageId: string;
  if (existing) {
    packageId = existing.id;
    await db
      .update(packages)
      .set({ ...packageValues, updatedAt: new Date() })
      .where(eq(packages.id, packageId));
  } else {
    const [row] = await db
      .insert(packages)
      .values({ owner: manifest.owner, name: manifest.name, ...packageValues })
      .returning({ id: packages.id });
    packageId = row.id;
  }

  const [versionRow] = await db
    .insert(packageVersions)
    .values({
      packageId,
      version: manifest.version,
      manifest,
      readme: readmeFile?.content ?? "",
    })
    .returning({ id: packageVersions.id });

  if (files.length) {
    await db.insert(packageFiles).values(
      files.map((f) => ({
        versionId: versionRow.id,
        path: f.path,
        size: Buffer.byteLength(f.content, "utf8"),
        content: f.content,
      }))
    );
  }

  return { id: packageId, version: manifest.version };
}
