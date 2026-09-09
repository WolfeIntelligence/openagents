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

  const tarPack = pack();

  for (const relPath of relativePaths) {
    const file = await getFile(relPath);
    if (!file || file.content === undefined) continue; // not found / not allowed — skip
    const buf = Buffer.from(file.content, "utf-8");
    await new Promise<void>((resolve, reject) => {
      tarPack.entry({ name: `${prefix}/${relPath}`, size: buf.length }, buf, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  tarPack.finalize();

  const chunks: Buffer[] = [];
  for await (const chunk of tarPack) {
    chunks.push(chunk as Buffer);
  }
  const tarBuffer = Buffer.concat(chunks);
  return gzipSync(tarBuffer);
}
