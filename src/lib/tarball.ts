// Builds a gzip'd tarball of a package (`openagent.yaml`, `README.md`, and
// every file declared in the manifest), rooted under an `<owner>-<name>/`
// prefix — used by the download route and (indirectly) the CLI's `add`.

import { pack } from "tar-stream";
import { gzipSync } from "node:zlib";
import type { Package, PackageFile } from "@/lib/types";

/** Fetches one file's content by package-relative path. Mirrors `Catalog["getFile"]` curried on owner/name. */
export type GetFileFn = (path: string) => Promise<PackageFile | null>;

/** Packs `openagent.yaml`, `README.md`, and `pkg.manifest.files` into a gzip tar under `<owner>-<name>/`. */
export async function packageTarball(pkg: Package, getFile: GetFileFn): Promise<Buffer> {
  const prefix = `${pkg.owner}-${pkg.name}`;
  const relativePaths = Array.from(
    new Set<string>(["openagent.yaml", "README.md", pkg.manifest.entry, ...pkg.manifest.files])
  );

  // Load every file first, then write all tar entries while a consumer is
  // already attached. Awaiting each entry before anything reads the stream
  // deadlocks as soon as the package exceeds the stream's internal buffer.
  const files: { relPath: string; buf: Buffer }[] = [];
  for (const relPath of relativePaths) {
    const file = await getFile(relPath);
    if (!file || file.content === undefined) continue; // not found / not allowed — skip
    files.push({ relPath, buf: Buffer.from(file.content, "utf-8") });
  }

  const tarPack = pack();
  const collected = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    tarPack.on("data", (chunk) => chunks.push(chunk as Buffer));
    tarPack.on("end", () => resolve(Buffer.concat(chunks)));
    tarPack.on("error", reject);
  });

  for (const { relPath, buf } of files) {
    tarPack.entry({ name: `${prefix}/${relPath}`, size: buf.length }, buf);
  }
  tarPack.finalize();

  return gzipSync(await collected);
}
