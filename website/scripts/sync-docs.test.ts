import { describe, it, expect } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteDir = path.resolve(__dirname, "..");
const docsDir = path.join(websiteDir, "src", "content", "docs");
const publicDir = path.join(websiteDir, "public");

function runSync() {
  execSync("bun run sync-docs", {
    cwd: websiteDir,
    env: { ...process.env, SITE_URL: "https://sverka-dev.github.io", BASE_PATH: "/sverka" },
    stdio: "pipe",
  });
}

describe("sync-docs", () => {
  it("generates user index with editUrl", () => {
    runSync();
    const index = path.join(docsDir, "user/index.md");
    expect(fs.existsSync(index)).toBe(true);
    const content = fs.readFileSync(index, "utf-8");
    expect(content).toContain("editUrl:");
    expect(content).toContain("https://github.com/sverka-dev/sverka/edit/main/engdocs/user/README.md");
  });

  it("generates engineering landing with editUrl", () => {
    const index = path.join(docsDir, "engineering/index.md");
    expect(fs.existsSync(index)).toBe(true);
    const content = fs.readFileSync(index, "utf-8");
    expect(content).toContain("editUrl: https://github.com/sverka-dev/sverka/edit/main/engdocs/README.md");
  });

  it("generates specs landing page", () => {
    const index = path.join(docsDir, "specs/index.md");
    expect(fs.existsSync(index)).toBe(true);
    const content = fs.readFileSync(index, "utf-8");
    expect(content).toMatch(/^---/);
    expect(content).toContain("Specifications");
  });

  it("includes runbooks in generated docs", () => {
    const runbook = path.join(docsDir, "engineering/runbooks/merge-stack-post-merge.md");
    expect(fs.existsSync(runbook)).toBe(true);
  });

  it("copies mermaid bundle", () => {
    expect(fs.existsSync(path.join(publicDir, "mermaid.min.js"))).toBe(true);
  });

  it("writes sitemap url to robots.txt", () => {
    const robots = fs.readFileSync(path.join(publicDir, "robots.txt"), "utf-8");
    expect(robots).toContain("Sitemap: https://sverka-dev.github.io/sverka/sitemap-index.xml");
  });

  it("preserves index.mdx and uses relative links", () => {
    const index = fs.readFileSync(path.join(docsDir, "index.mdx"), "utf-8");
    expect(index).toContain("editUrl:");
    expect(index).not.toContain("link: /user/");
    expect(index).toContain("link: user/");
  });
});
