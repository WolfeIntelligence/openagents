import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export interface DocEntry {
  slug: string;
  title: string;
  description?: string;
  order: number;
  content: string;
}

const DOCS_DIR = path.join(process.cwd(), "src", "content", "docs");

export function getAllDocs(): DocEntry[] {
  if (!fs.existsSync(DOCS_DIR)) return [];

  const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));

  const docs = files.map((file) => {
    const raw = fs.readFileSync(path.join(DOCS_DIR, file), "utf8");
    const { data, content } = matter(raw);
    const slug = file.replace(/\.md$/, "");
    return {
      slug,
      title: typeof data.title === "string" ? data.title : slug,
      description: typeof data.description === "string" ? data.description : undefined,
      order: typeof data.order === "number" ? data.order : 0,
      content,
    };
  });

  return docs.sort((a, b) => a.order - b.order);
}

export function getDoc(slug: string): DocEntry | undefined {
  return getAllDocs().find((d) => d.slug === slug);
}
