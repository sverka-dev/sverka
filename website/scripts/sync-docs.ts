/**
 * Sync engdocs/user/*.md → website/content/docs/ (fumadocs source).
 *
 * - extracts title from the first `# H1` (fumadocs needs `title` frontmatter)
 * - rewrites relative .md links into site paths
 * - generates meta.json files for sidebar ordering
 * - collapses specs/features/F-*.md into a single features.mdx summary
 *
 * Output is generated — content/docs is gitignored except this pipeline
 * owns it entirely (it deletes what it does not write).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const websiteDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(websiteDir, "..");
const docsRoot = path.resolve(websiteDir, "content/docs");
const userDocsSrc = path.resolve(repoRoot, "engdocs/user");
const featuresSrc = path.resolve(repoRoot, "specs/features");

interface FileEntry {
  srcPath: string;
  destPath: string;
  route: string;
  isIndex: boolean;
}

class DocsSyncError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DocsSyncError";
  }
}

function posix(p: string): string {
  return p.split(path.sep).join("/");
}

async function collectFiles(): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  const walk = async (dir: string): Promise<string[]> => {
    const dirEntries = await fs.readdir(dir, { withFileTypes: true });
    let found: string[] = [];
    for (const entry of dirEntries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        found = found.concat(await walk(full));
      } else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
        found.push(full);
      }
    }
    return found;
  };

  const files = await walk(userDocsSrc);
  for (const file of files) {
    const rel = posix(path.relative(userDocsSrc, file));
    const parts = rel.split("/");
    const fileName = parts[parts.length - 1];
    const dirParts = parts.slice(0, -1);
    const isIndex = fileName === "README.md" || fileName === "index.md";
    const destPath = path.join(
      docsRoot,
      ...dirParts,
      isIndex ? "index.mdx" : fileName.replace(/\.md$/, ".mdx"),
    );
    const route = isIndex
      ? dirParts.join("/")
      : [...dirParts, fileName.replace(/\.mdx?$/, "")].join("/");
    entries.push({ srcPath: file, destPath, route, isIndex });
  }
  return entries;
}

function parseFrontmatter(content: string): {
  body: string;
  fields: Record<string, unknown>;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return { body: content, fields: {} };
  let fields: Record<string, unknown> = {};
  const raw = match[1];
  if (raw.trim()) {
    try {
      const parsed = parseYaml(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        fields = parsed as Record<string, unknown>;
      }
    } catch (err) {
      throw new DocsSyncError(`Invalid YAML frontmatter: ${err}`, {
        cause: err,
      });
    }
  }
  return { body: content.slice(match[0].length), fields };
}

function extractTitle(body: string): string | undefined {
  return /^#\s+(.+)$/m.exec(body)?.[1].trim();
}

function extractDescription(body: string): string | undefined {
  for (const p of body.split(/\r?\n\r?\n/)) {
    const trimmed = p.trim();
    if (
      trimmed &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("```") &&
      !trimmed.startsWith("- ")
    ) {
      const text = trimmed.replace(/\s+/g, " ");
      return text.length <= 160
        ? text
        : text.slice(0, 160).replace(/\s+\S*$/, "");
    }
  }
  return undefined;
}

function fileNameToTitle(filePath: string): string {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const ACRONYMS = new Set(["api", "cli", "ci", "sarif", "mcp", "oidc"]);

function formatLabel(slug: string): string {
  return slug
    .split(/[-_]+/)
    .map((word) =>
      ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");
}

function stripLeadingH1(body: string, title: string): string {
  const trimmed = body.replace(/^\s+/, "");
  const newlineIndex = trimmed.indexOf("\n");
  const firstLine =
    newlineIndex === -1 ? trimmed : trimmed.slice(0, newlineIndex);
  const lineText = firstLine.trim();
  if (!lineText.startsWith("# ")) return body;
  if (
    lineText
      .slice(2)
      .trim()
      .localeCompare(title.trim(), undefined, { sensitivity: "base" }) === 0
  ) {
    return trimmed.slice(firstLine.length).replace(/^\s+/, "");
  }
  return body;
}

function rewriteLinks(
  body: string,
  currentSrcPath: string,
  sourceToRoute: Map<string, string>,
): string {
  const currentSrcDir = posix(path.dirname(currentSrcPath));
  return body.replace(
    /!?\[([^\]]*)\]\(([^)]+)\)/g,
    (full, text: string, href: string) => {
      if (full.startsWith("!")) return full;
      if (/^(https?:|mailto:|#|\/)/.test(href)) return full;
      const [cleanHref, ...anchorParts] = href.split("#");
      const anchor = anchorParts.length ? `#${anchorParts.join("#")}` : "";
      const resolvedSrc = posix(
        path.resolve(currentSrcDir, cleanHref.split("?")[0]),
      );
      const key = posix(path.relative(userDocsSrc, resolvedSrc)).replace(
        /\.mdx?$/i,
        "",
      );
      const target = sourceToRoute.get(key);
      if (target === undefined) {
        console.warn(`Unresolved internal link in ${currentSrcPath}: ${href}`);
        return `[${text}](${cleanHref}${anchor})`;
      }
      return `[${text}](/docs${target ? `/${target}` : ""}${anchor})`;
    },
  );
}

function readSectionOrder(readme: string): string[] {
  const order: string[] = [];
  const linkRegex = /\]\(\.\/([^\/\s\)#]+)(?:\/[^\)]*)?\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(readme)) !== null) {
    if (!order.includes(match[1])) order.push(match[1]);
  }
  return order;
}

async function writeMeta(dir: string, meta: unknown): Promise<void> {
  await fs.writeFile(
    path.join(docsRoot, dir, "meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
    "utf-8",
  );
}

async function writeMetaFiles(entries: FileEntry[]): Promise<void> {
  const dirs = new Map<string, FileEntry[]>();
  const standalone: FileEntry[] = [];
  let rootIndex: FileEntry | undefined;
  for (const e of entries) {
    if (e.route === "") {
      rootIndex = e;
      continue;
    }
    const slash = e.route.indexOf("/");
    if (slash === -1) {
      if (e.isIndex) {
        // folder index like `use-cases` — registers the folder itself
        if (!dirs.has(e.route)) dirs.set(e.route, []);
        dirs.get(e.route)!.push(e);
      } else {
        standalone.push(e);
      }
      continue;
    }
    const dir = e.route.slice(0, slash);
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir)!.push(e);
  }

  let order: string[] = [];
  if (rootIndex) {
    order = readSectionOrder(await fs.readFile(rootIndex.srcPath, "utf-8"));
  }
  const orderIndex = new Map(order.map((n, i) => [n, i]));
  const sortedDirs = [...dirs.keys()].sort((a, b) => {
    const ia = orderIndex.get(a);
    const ib = orderIndex.get(b);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return a.localeCompare(b);
  });

  await writeMeta("", {
    title: "Docs",
    pages: [
      "index",
      ...sortedDirs,
      ...standalone.map((e) => e.route),
      "features",
    ],
  });

  for (const dir of sortedDirs) {
    const pages = dirs
      .get(dir)!
      .map((e) => (e.isIndex ? "index" : path.basename(e.route)))
      .sort((a, b) =>
        a === "index" ? -1 : b === "index" ? 1 : a.localeCompare(b),
      );
    await writeMeta(dir, { title: formatLabel(dir), pages });
  }
}

async function cleanDocsRoot(): Promise<void> {
  await fs.rm(docsRoot, { recursive: true, force: true });
  await fs.mkdir(docsRoot, { recursive: true });
  await fs.writeFile(path.join(docsRoot, ".gitignore"), "*\n!.gitignore\n");
}

/** specs/features/F-*.md → one generated features.mdx summary page. */
async function writeFeaturesSummary(): Promise<void> {
  const files = (await fs.readdir(featuresSrc))
    .filter((f) => /^F-\d+.*\.md$/.test(f))
    .sort();
  interface Feature {
    file: string;
    id: string;
    title: string;
    category: string;
    status: string;
  }
  const features: Feature[] = [];
  for (const f of files) {
    const content = await fs.readFile(path.join(featuresSrc, f), "utf-8");
    const field = (name: string) =>
      new RegExp(`\\*\\*${name}:\\*\\*\\s*(.+)`).exec(content)?.[1].trim() ??
      "";
    features.push({
      file: f,
      id: field("ID") || f.replace(/\.md$/, ""),
      title:
        /^#\s+Feature:\s*(.+)$/m.exec(content)?.[1].trim() ??
        fileNameToTitle(f),
      category: field("Category"),
      status: field("Status"),
    });
  }

  const byCategory = new Map<string, Feature[]>();
  for (const f of features) {
    const key = f.category || "other";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(f);
  }

  const sections = [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => {
      const rows = items
        .map(
          (f) =>
            `| ${f.id} | [${f.title}](https://github.com/sverka-dev/sverka/blob/main/specs/features/${f.file}) | ${f.status} |`,
        )
        .join("\n");
      return `## ${formatLabel(category)}\n\n| ID | Feature | Status |\n|---|---|---|\n${rows}`;
    })
    .join("\n\n");

  const page = `---
title: CI Compatibility Features
description: GitHub Actions / GitLab CI feature coverage — one page per proposal lives in specs/features/.
---

These ${features.length} feature specs define sverka's CI-compilation surface
(GitHub Actions / GitLab CI parity). Each \`F-XX\` is a standalone proposal in
[\`specs/features/\`](https://github.com/sverka-dev/sverka/tree/main/specs/features).

${sections}
`;
  await fs.writeFile(path.join(docsRoot, "features.mdx"), page, "utf-8");
}

async function syncDocs(): Promise<void> {
  const entries = await collectFiles();
  const sourceToRoute = new Map<string, string>();
  for (const e of entries) {
    const key = posix(path.relative(userDocsSrc, e.srcPath)).replace(
      /\.mdx?$/i,
      "",
    );
    sourceToRoute.set(key, e.route);
  }

  await cleanDocsRoot();

  for (const entry of entries) {
    const content = await fs.readFile(entry.srcPath, "utf-8");
    const { body, fields } = parseFrontmatter(content);
    const title =
      (typeof fields.title === "string" ? fields.title : undefined) ||
      extractTitle(body) ||
      fileNameToTitle(entry.srcPath);
    const description =
      (typeof fields.description === "string"
        ? fields.description
        : undefined) || extractDescription(body);

    const fm: Record<string, unknown> = { title };
    if (description) fm.description = description;
    const frontmatter = `---\n${stringifyYaml(fm, {
      lineWidth: 0,
      defaultStringType: "PLAIN",
    })}---\n\n`;

    const linked = rewriteLinks(
      stripLeadingH1(body, title),
      entry.srcPath,
      sourceToRoute,
    );
    await fs.mkdir(path.dirname(entry.destPath), { recursive: true });
    await fs.writeFile(entry.destPath, frontmatter + linked, "utf-8");
  }

  await writeMetaFiles(entries);
  await writeFeaturesSummary();
}

await syncDocs();
