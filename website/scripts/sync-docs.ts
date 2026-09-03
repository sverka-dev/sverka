import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const docsRoot = path.resolve(repoRoot, "website/src/content/docs");
const publicDir = path.resolve(repoRoot, "website/public");
const websiteDir = path.resolve(repoRoot, "website");

interface RootMapping {
  src: string;
  dest: string;
  indexNames: string[];
}

const roots: RootMapping[] = [
  { src: "engdocs/user", dest: "user", indexNames: ["README.md"] },
  { src: "specs/features", dest: "features", indexNames: ["overview.md"] },
];

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

function routeForDest(destPath: string, isIndex: boolean): string {
  const rel = posix(path.relative(docsRoot, destPath));
  if (isIndex) {
    const dir = path.posix.dirname(rel);
    return dir === "." ? "" : dir;
  }
  return rel.replace(/\.mdx?$/, "");
}

async function collectFiles(): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];

  for (const root of roots) {
    const srcDir = path.resolve(repoRoot, root.src);
    const destDir = path.resolve(docsRoot, root.dest);

    const walk = async (dir: string): Promise<string[]> => {
      const dirEntries = await fs.readdir(dir, { withFileTypes: true });
      let found: string[] = [];
      for (const entry of dirEntries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          found = found.concat(await walk(full));
        } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mdx"))) {
          found.push(full);
        }
      }
      return found;
    };

    let files: string[];
    try {
      files = await walk(srcDir);
    } catch (err) {
      throw new DocsSyncError(`Could not read source docs directory ${srcDir}`, { cause: err });
    }

    for (const file of files) {
      const rel = posix(path.relative(srcDir, file));
      const parts = rel.split("/");
      const fileName = parts[parts.length - 1];
      const dirParts = parts.slice(0, -1);
      const isIndex = root.indexNames.includes(fileName);
      const destFileName = isIndex ? "index.md" : fileName;
      const destPath = path.join(destDir, ...dirParts, destFileName);
      entries.push({ srcPath: file, destPath, route: "", isIndex });
    }
  }

  return entries.map((entry) => ({
    ...entry,
    route: routeForDest(entry.destPath, entry.isIndex),
  }));
}

function parseFrontmatter(content: string): { frontmatter: string; body: string; fields: Record<string, unknown> } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) {
    return { frontmatter: "", body: content, fields: {} };
  }

  const raw = match[1];
  let fields: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      const parsed = parseYaml(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        fields = parsed as Record<string, unknown>;
      }
    } catch (err) {
      throw new DocsSyncError(`Invalid YAML frontmatter: ${err}`, { cause: err });
    }
  }

  return { frontmatter: match[0], body: content.slice(match[0].length), fields };
}

function extractTitle(body: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(body);
  return match?.[1].trim();
}

function extractDescription(body: string): string | undefined {
  const paragraphs = body.split(/\r?\n\r?\n/);
  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("```")) {
      return trimmed.replace(/\s+/g, " ").slice(0, 160);
    }
  }
  return undefined;
}

function fileNameToTitle(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const ACRONYMS = new Set(["api", "cli", "ci", "sarif"]);

function formatLabel(slug: string): string {
  return slug
    .split(/[-_]+/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function stripLeadingH1(body: string, title: string): string {
  const trimmed = body.replace(/^\s+/, "");
  const newlineIndex = trimmed.indexOf("\n");
  const firstLine = newlineIndex === -1 ? trimmed : trimmed.slice(0, newlineIndex);
  const lineText = firstLine.trim();
  if (!lineText.startsWith("# ")) return body;
  const headingText = lineText.slice(2).trim();
  if (headingText.localeCompare(title.trim(), undefined, { sensitivity: "base" }) === 0) {
    return trimmed.slice(firstLine.length).replace(/^\s+/, "");
  }
  return body;
}

function parseExistingFrontmatter(rawFrontmatter: string): Record<string, unknown> {
  if (!rawFrontmatter) return {};
  const inner = rawFrontmatter
    .replace(/^---\r?\n/, "")
    .replace(/\r?\n---\r?\n?$/, "");
  if (!inner.trim()) return {};
  try {
    const parsed = parseYaml(inner);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (err) {
    throw new DocsSyncError(`Invalid YAML frontmatter: ${err}`, { cause: err });
  }
  throw new DocsSyncError("Frontmatter must be a YAML object mapping");
}

function mergeFrontmatter(
  rawFrontmatter: string,
  title: string,
  description: string | undefined,
  editUrl: string,
  sidebar?: Record<string, unknown>,
): string {
  const existing = parseExistingFrontmatter(rawFrontmatter);
  const excluded = new Set(["title", "description", "editUrl"]);
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (!excluded.has(key)) fields[key] = value;
  }

  fields.title = title;
  if (description) fields.description = description;
  fields.editUrl = editUrl;
  if (sidebar) fields.sidebar = sidebar;
  fields.banner = {
    content:
      "⚠️ Work in progress — pre-alpha. APIs may change. Not ready for production use.",
  };

  const yaml = stringifyYaml(fields, { lineWidth: 0, defaultStringType: "PLAIN" });
  return `---\n${yaml}---\n\n`;
}

function rewriteLink(
  text: string,
  href: string,
  currentSrcPath: string,
  currentSrcDir: string,
  currentRoutePath: string,
  sourceToRoute: Map<string, string>,
): string {
  if (/^(https?:|mailto:|#|\/)/.test(href)) return `[${text}](${href})`;

  const [cleanHref, ...anchorParts] = href.split("#");
  const anchor = anchorParts.length ? `#${anchorParts.join("#")}` : "";
  const clean = cleanHref.split("?")[0];

  const resolvedSrc = posix(path.resolve(currentSrcDir, clean));
  const srcRel = posix(path.relative(repoRoot, resolvedSrc)).replace(/\.mdx?$/i, "");
  const targetRoute = sourceToRoute.get(srcRel);
  if (!targetRoute) {
    console.warn(`Unresolved internal link in ${currentSrcPath}: ${href}`);
    let newHref = clean.replace(/\.mdx?$/i, "");
    if (!newHref.endsWith("/")) newHref += "/";
    return `[${text}](${newHref}${anchor})`;
  }

  const targetRoutePath = `${targetRoute}/`;
  let relative = path.posix.relative(currentRoutePath, targetRoutePath);
  if (relative === "") relative = "./";
  if (!relative.endsWith("/")) relative += "/";
  return `[${text}](${relative}${anchor})`;
}

function transformLinks(
  body: string,
  currentSrcPath: string,
  sourceToRoute: Map<string, string>,
): string {
  const currentSrcDir = posix(path.dirname(currentSrcPath));
  const currentSrcKey = posix(path.relative(repoRoot, currentSrcPath)).replace(/\.mdx?$/i, "");
  const currentRoute = sourceToRoute.get(currentSrcKey);
  if (!currentRoute) return body;
  const currentRoutePath = `${currentRoute}/`;

  const linkRegex = /!?\[([^\]]*)\]\(([^)]+)\)/g;
  const segments: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(body)) !== null) {
    const [full, text, href] = match;
    segments.push(body.slice(lastIndex, match.index));
    if (full.startsWith("!")) {
      segments.push(full);
    } else {
      segments.push(rewriteLink(text, href, currentSrcPath, currentSrcDir, currentRoutePath, sourceToRoute));
    }
    lastIndex = match.index + full.length;
    if (match.index === linkRegex.lastIndex) {
      linkRegex.lastIndex++;
    }
  }
  segments.push(body.slice(lastIndex));
  return segments.join("");
}

async function cleanDocsRoot() {
  const keepRoot = new Set(["index.mdx", ".gitignore"]);
  try {
    const top = await fs.readdir(docsRoot, { withFileTypes: true });
    for (const entry of top) {
      const entryPath = path.join(docsRoot, entry.name);
      if (entry.isDirectory()) {
        await fs.rm(entryPath, { recursive: true, force: true });
      } else if (!keepRoot.has(entry.name)) {
        await fs.rm(entryPath, { force: true });
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      await fs.mkdir(docsRoot, { recursive: true });
    } else {
      throw new DocsSyncError(`Failed to clean docs directory ${docsRoot}`, { cause: err });
    }
  }
}

async function writeRobotsTxt() {
  const site = (process.env.SITE_URL || "https://sverka.dev").replace(/\/+$/, "");
  const baseInput = process.env.BASE_PATH || "/";
  const basePath = baseInput === "/" ? "" : baseInput.replace(/\/$/, "");
  const sitemapUrl = `${site}${basePath}/sitemap-index.xml`;
  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`;
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.resolve(publicDir, "robots.txt"), robots, "utf-8");
}

async function copyMermaid() {
  const mermaidSrc = path.resolve(repoRoot, "website/node_modules/mermaid/dist/mermaid.min.js");
  const mermaidDest = path.resolve(publicDir, "mermaid.min.js");
  try {
    await fs.copyFile(mermaidSrc, mermaidDest);
  } catch (err) {
    throw new DocsSyncError(`Failed to copy mermaid bundle from ${mermaidSrc}`, { cause: err });
  }
}


async function syncDocs() {
  const entries = await collectFiles();
  const sourceToRoute = new Map<string, string>();
  for (const entry of entries) {
    const srcRel = posix(path.relative(repoRoot, entry.srcPath));
    const key = srcRel.replace(/\.mdx?$/i, "");
    sourceToRoute.set(key, entry.route);
  }

  await cleanDocsRoot();

  for (const entry of entries) {
    const content = await fs.readFile(entry.srcPath, "utf-8");
    const { frontmatter: existingFrontmatter, body, fields } = parseFrontmatter(content);

    const title =
      (typeof fields.title === "string" ? fields.title : undefined) ||
      extractTitle(body) ||
      fileNameToTitle(entry.srcPath);
    const description =
      (typeof fields.description === "string" ? fields.description : undefined) ||
      extractDescription(body);
    const srcEditPath = posix(path.relative(repoRoot, entry.srcPath));
    const editUrl = `https://github.com/sverka-dev/sverka/edit/main/${srcEditPath}`;

    const rawBody = existingFrontmatter ? body : content;
    const dedupedBody = stripLeadingH1(rawBody, title);
    const linkedBody = transformLinks(dedupedBody, entry.srcPath, sourceToRoute);

    const sidebar = entry.isIndex ? { label: "Overview" } : undefined;
    const frontmatter = mergeFrontmatter(existingFrontmatter, title, description, editUrl, sidebar);
    await fs.mkdir(path.dirname(entry.destPath), { recursive: true });
    await fs.writeFile(entry.destPath, frontmatter + linkedBody, "utf-8");
  }

  await writeSidebarConfig(entries);
  await copyMermaid();
  await writeRobotsTxt();
}

function readSectionOrder(readme: string): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const linkRegex = /\]\(\.\/([^\/\s\)#]+)(?:\/[^\)]*)?\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(readme)) !== null) {
    const dir = match[1];
    if (!seen.has(dir)) {
      seen.add(dir);
      order.push(dir);
    }
  }
  return order;
}

async function writeSidebarConfig(entries: FileEntry[]) {
  const userSubDirs = new Set<string>();
  const standalone: Array<{ slug: string; srcPath: string }> = [];
  const readmeEntry = entries.find((e) => e.isIndex && e.route === "user");

  for (const entry of entries) {
    if (!entry.route.startsWith("user/")) continue;
    const rest = entry.route.slice("user/".length);
    if (!rest) continue;
    const slashIndex = rest.indexOf("/");
    if (slashIndex !== -1) {
      userSubDirs.add(rest.slice(0, slashIndex));
      continue;
    }
    if (entry.isIndex) {
      userSubDirs.add(rest);
    } else {
      standalone.push({ slug: entry.route, srcPath: entry.srcPath });
    }
  }

  let order: string[] = [];
  if (readmeEntry) {
    try {
      const readme = await fs.readFile(readmeEntry.srcPath, "utf-8");
      order = readSectionOrder(readme);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  const orderIndex = new Map(order.map((name, idx) => [name, idx]));
  const sortedDirs = Array.from(userSubDirs).sort((a, b) => {
    const ia = orderIndex.get(a);
    const ib = orderIndex.get(b);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return a.localeCompare(b);
  });

  const hasFeatures = entries.some((e) => e.route.startsWith("features/"));
  const featureItems: unknown[] = [];
  if (hasFeatures) {
    featureItems.push({ slug: "features", label: "CI Compatibility Matrix" });
    featureItems.push({
      label: "All features",
      items: [{ autogenerate: { directory: "features", collapsed: true } }],
    });
  }

  const userItems: unknown[] = [{ slug: "user" }];
  for (const dir of sortedDirs) {
    const items: unknown[] = [{ autogenerate: { directory: `user/${dir}`, collapsed: false } }];
    // Inject CI compatibility matrix under Reference.
    if (dir === "reference" && hasFeatures) {
      items.push(...featureItems);
    }
    userItems.push({ label: formatLabel(dir), items });
  }
  standalone.sort((a, b) => fileNameToTitle(a.srcPath).localeCompare(fileNameToTitle(b.srcPath)));
  for (const page of standalone) {
    userItems.push({ label: fileNameToTitle(page.srcPath), slug: page.slug });
  }

  const sidebar = [
    { slug: "index" },
    { label: "User documentation", collapsed: false, items: userItems },
  ];

  try {
    await fs.writeFile(
      path.resolve(websiteDir, "sidebar.generated.mjs"),
      `export const sidebar = ${JSON.stringify(sidebar, null, 2)};\n`,
      "utf-8",
    );
  } catch (err) {
    throw new DocsSyncError(`Failed to write generated sidebar config: ${err}`, { cause: err });
  }
}

await syncDocs();
