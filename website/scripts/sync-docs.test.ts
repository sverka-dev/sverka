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
  it("generates user docs with editUrl", () => {
    runSync();
    const index = path.join(docsDir, "user/index.md");
    expect(fs.existsSync(index)).toBe(true);
    const content = fs.readFileSync(index, "utf-8");
    expect(content).toContain("editUrl:");
    expect(content).toContain("https://github.com/sverka-dev/sverka/edit/main/engdocs/user/README.md");
  });

  it("does not publish engineering or specs sections", () => {
    runSync();
    expect(fs.existsSync(path.join(docsDir, "engineering"))).toBe(false);
    expect(fs.existsSync(path.join(docsDir, "specs"))).toBe(false);
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

  it("generates sidebar config with curated section order", () => {
    runSync();
    const sidebar = fs.readFileSync(path.join(websiteDir, "sidebar.generated.mjs"), "utf-8");
    expect(sidebar).toContain('"label": "User documentation"');
    expect(sidebar).toContain('"label": "Getting Started"');
    expect(sidebar).toContain('"label": "Workflow API"');
    expect(sidebar).toContain('"label": "CLI"');
    expect(sidebar).toContain('"directory": "user/getting-started"');
    expect(sidebar.indexOf('"label": "Getting Started"')).toBeLessThan(sidebar.indexOf('"label": "Workflow API"'));
    expect(sidebar.indexOf('"label": "Workflow API"')).toBeLessThan(sidebar.indexOf('"label": "CLI"'));
    expect(sidebar.indexOf('"label": "CLI"')).toBeLessThan(sidebar.indexOf('"label": "Checks"'));
  });

  it("does not duplicate the generated index heading", () => {
    runSync();
    const index = fs.readFileSync(path.join(docsDir, "user/index.md"), "utf-8");
    const headingMatches = (index.match(/^# Sverka — User Documentation$/gm) || []).length;
    expect(headingMatches).toBe(0);
    expect(index).toContain("sidebar:\n  label: Overview");
  });
});
