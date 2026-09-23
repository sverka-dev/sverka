/**
 * Post-process TypeDoc-generated API reference markdown.
 *
 * TypeDoc emits a README.md index page for the single @sverka/workflow
 * entry point. Starlight needs a `title` in frontmatter and a stable
 * filename, so this renames it to workflow.md and injects the title.
 */
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

const apiDir = join(process.cwd(), "website/src/content/docs/api");
const readmePath = join(apiDir, "README.md");
const targetPath = join(apiDir, "workflow.md");

const content = await readFile(readmePath, "utf8");

// Inject title into the generated frontmatter block.
const withTitle = content.replace(
  /^---\n([\s\S]*?)---/,
  (_match, body: string) => `---\ntitle: Workflow API\n${body}---`,
);

await writeFile(targetPath, withTitle, "utf8");
await rm(readmePath);
