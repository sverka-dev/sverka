import { describe, it, expect } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteDir = path.resolve(__dirname, "..");
const docsDir = path.join(websiteDir, "content", "docs");

function runSync() {
  execSync("bun run sync-docs", {
    cwd: websiteDir,
    stdio: "pipe",
  });
}

describe("sync-docs", () => {
  it("generates fumadocs pages with title frontmatter", () => {
    runSync();
    const index = path.join(docsDir, "index.mdx");
    expect(fs.existsSync(index)).toBe(true);
    const content = fs.readFileSync(index, "utf-8");
    expect(content).toMatch(/^---\ntitle: .+\n/);
    expect(
      fs.existsSync(path.join(docsDir, "getting-started/install.mdx")),
    ).toBe(true);
  });

  it("does not publish engineering or raw specs sections", () => {
    runSync();
    expect(fs.existsSync(path.join(docsDir, "engineering"))).toBe(false);
    expect(fs.existsSync(path.join(docsDir, "specs"))).toBe(false);
    expect(fs.existsSync(path.join(docsDir, "features"))).toBe(false);
  });

  it("collapses feature specs into a single summary page", () => {
    runSync();
    const page = fs.readFileSync(path.join(docsDir, "features.mdx"), "utf-8");
    expect(page).toContain("title: CI Compatibility Features");
    expect(page).toContain("F-24");
    expect(page).toContain("specs/features/F-24-artifact-outputs.md");
  });

  it("rewrites relative markdown links to /docs/ paths", () => {
    runSync();
    const index = fs.readFileSync(path.join(docsDir, "index.mdx"), "utf-8");
    expect(index).toContain("](/docs/concepts)");
    expect(index).not.toContain("](./concepts/README.md)");
  });

  it("generates meta.json with curated section order", () => {
    runSync();
    const meta = JSON.parse(
      fs.readFileSync(path.join(docsDir, "meta.json"), "utf-8"),
    ) as { pages: string[] };
    const order = meta.pages;
    expect(order[0]).toBe("index");
    expect(order[order.length - 1]).toBe("features");
    expect(order.indexOf("concepts")).toBeLessThan(order.indexOf("use-cases"));
    expect(order.indexOf("use-cases")).toBeLessThan(
      order.indexOf("getting-started"),
    );
    expect(order.indexOf("getting-started")).toBeLessThan(
      order.indexOf("running"),
    );
    // folders must not be duplicated
    expect(new Set(order).size).toBe(order.length);
  });

  it("writes per-folder meta.json with titles", () => {
    runSync();
    const meta = JSON.parse(
      fs.readFileSync(path.join(docsDir, "getting-started/meta.json"), "utf-8"),
    ) as { title: string; pages: string[] };
    expect(meta.title).toBe("Getting Started");
    expect(meta.pages).toContain("install");
    expect(meta.pages).toContain("first-plan");
  });

  it("does not duplicate the extracted H1 in the body", () => {
    runSync();
    const index = fs.readFileSync(path.join(docsDir, "index.mdx"), "utf-8");
    expect(index).not.toContain("# Sverka — User Documentation");
  });
});
