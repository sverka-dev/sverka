/**
 * Build the static search index for fumadocs `staticClient`.
 *
 * staticClient fetches `${BASE}/api/search` — on GitHub Pages there is no
 * server, so we bake the Orama export to `public/api/search` at build time.
 * Runs after sync-docs (content/docs is generated).
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSearchAPI, type Index } from "fumadocs-core/search/server";

const websiteDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const docsRoot = path.join(websiteDir, "content/docs");
const outFile = path.join(websiteDir, "public/api/search");
const BASE = "";

async function collect(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await collect(full)));
    else if (e.name.endsWith(".mdx")) out.push(full);
  }
  return out;
}

function frontmatter(content: string): {
  title?: string;
  description?: string;
  body: string;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!m) return { body: content };
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return {
    title: fm.title,
    description: fm.description,
    body: content.slice(m[0].length),
  };
}

function stripMarkdown(body: string): string {
  // line-based fence removal — no backtracking regex over the whole body
  let inFence = false;
  const withoutFences = body
    .split("\n")
    .filter((line) => {
      if (line.trimStart().startsWith("```")) {
        inFence = !inFence;
        return false;
      }
      return !inFence;
    })
    .join("\n");
  return withoutFences
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*`_|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function urlFor(file: string): string {
  const rel = path
    .relative(docsRoot, file)
    .split(path.sep)
    .join("/")
    .replace(/\.mdx$/, "")
    .replace(/\/index$/, "")
    .replace(/^index$/, "");
  return `${BASE}/docs${rel ? `/${rel}` : ""}`;
}

const files = await collect(docsRoot);
const indexes: Index[] = [];
for (const file of files) {
  const { title, description, body } = frontmatter(
    await readFile(file, "utf-8"),
  );
  if (!title) continue;
  indexes.push({
    title,
    description,
    url: urlFor(file),
    content: stripMarkdown(body).slice(0, 8000),
  });
}

const api = createSearchAPI("simple", { indexes });
const res = await api.staticGET();
await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, await res.text(), "utf-8");
console.log(`search index → ${outFile} (${indexes.length} pages)`);
