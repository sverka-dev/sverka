import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const docsRoot = path.resolve(repoRoot, "website/src/content/docs");
const publicDir = path.resolve(repoRoot, "website/public");

interface RootMapping {
  src: string;
  dest: string;
  indexNames: string[];
}

const roots: RootMapping[] = [
  { src: "engdocs/user", dest: "user", indexNames: ["README.md"] },
  { src: "engdocs/architecture", dest: "engineering/architecture", indexNames: ["README.md"] },
  { src: "engdocs/adr", dest: "engineering/adrs", indexNames: ["README.md"] },
  { src: "engdocs/contributing", dest: "engineering/contributing", indexNames: ["README.md"] },
  { src: "specs", dest: "specs", indexNames: ["spec.md"] },
];

const singleFiles: { src: string; dest: string }[] = [
  { src: "engdocs/README.md", dest: "engineering/index.md" },
];

interface FileEntry {
  srcPath: string;
  destPath: string;
  route: string;
  isIndex: boolean;
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
    let files: string[] = [];
    try {
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
      files = await walk(srcDir);
    } catch {
      continue;
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

  for (const single of singleFiles) {
    const srcPath = path.resolve(repoRoot, single.src);
    const destPath = path.resolve(docsRoot, single.dest);
    const isIndex = path.posix.basename(single.dest) === "index.md";
    entries.push({ srcPath, destPath, route: "", isIndex });
  }

  return entries.map((entry) => ({
    ...entry,
    route: routeForDest(entry.destPath, entry.isIndex),
  }));
}

function parseFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match) {
    return { frontmatter: match[0], body: content.slice(match[0].length) };
  }
  return { frontmatter: "", body: content };
}

function extractTitle(body: string): string | undefined {
  const match = body.match(/^#\s+(.+)$/m);
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

  return body.replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g, (match, bang, text, href) => {
    if (bang) return match;

    const raw = href as string;
    if (/^(https?:|mailto:|#|\/)/.test(raw)) return match;

    const [cleanHref, ...anchorParts] = raw.split("#");
    const anchor = anchorParts.length ? `#${anchorParts.join("#")}` : "";
    const clean = cleanHref.split("?")[0];

    const resolvedSrc = posix(path.resolve(currentSrcDir, clean));
    const srcRel = posix(path.relative(repoRoot, resolvedSrc)).replace(/\.mdx?$/i, "");
    const targetRoute = sourceToRoute.get(srcRel) ?? sourceToRoute.get(`${srcRel}.md`) ?? sourceToRoute.get(`${srcRel}.mdx`);
    if (!targetRoute) {
      let newHref = clean.replace(/\.mdx?$/i, "");
      if (!newHref.endsWith("/")) newHref += "/";
      return `[${text}](${newHref}${anchor})`;
    }

    const targetRoutePath = `${targetRoute}/`;
    let relative = path.posix.relative(currentRoutePath, targetRoutePath);
    if (relative === "") relative = "./";
    if (!relative.endsWith("/")) relative += "/";
    return `[${text}](${relative}${anchor})`;
  });
}

async function syncDocs() {
  const entries = await collectFiles();
  const sourceToRoute = new Map<string, string>();
  for (const entry of entries) {
    const srcRel = posix(path.relative(repoRoot, entry.srcPath));
    const key = srcRel.replace(/\.mdx?$/i, "");
    sourceToRoute.set(key, entry.route);
  }

  const keepRoot = new Set(["index.mdx", ".gitignore"]);
  try {
    const top = await fs.readdir(docsRoot, { withFileTypes: true });
    for (const entry of top) {
      if (entry.isDirectory()) {
        await fs.rm(path.join(docsRoot, entry.name), { recursive: true, force: true });
      } else if (!keepRoot.has(entry.name)) {
        await fs.rm(path.join(docsRoot, entry.name), { force: true });
      }
    }
  } catch {
    await fs.mkdir(docsRoot, { recursive: true });
  }

  for (const entry of entries) {
    const content = await fs.readFile(entry.srcPath, "utf-8");
    const { frontmatter: existingFrontmatter, body } = parseFrontmatter(content);
    const title = extractTitle(body) ?? path.basename(entry.srcPath, ".md");
    const description = extractDescription(body);

    let newBody = existingFrontmatter ? body : content;
    newBody = transformLinks(newBody, entry.srcPath, sourceToRoute);

    const frontmatter = `---\ntitle: ${JSON.stringify(title)}\n${description ? `description: ${JSON.stringify(description)}\n` : ""}---\n\n`;
    await fs.mkdir(path.dirname(entry.destPath), { recursive: true });
    await fs.writeFile(entry.destPath, frontmatter + newBody, "utf-8");
  }

  const mermaidSrc = path.resolve(repoRoot, "website/node_modules/mermaid/dist/mermaid.min.js");
  const mermaidDest = path.resolve(publicDir, "mermaid.min.js");
  try {
    await fs.copyFile(mermaidSrc, mermaidDest);
  } catch {
    // Mermaid may not be installed.
  }
}

await syncDocs();
