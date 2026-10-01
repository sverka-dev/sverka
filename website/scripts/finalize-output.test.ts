import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finalizeOutput } from "./finalize-output";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "finalize-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("finalizeOutput", () => {
  it("copies _shell.html to index.html when index is missing", async () => {
    fs.writeFileSync(path.join(dir, "_shell.html"), "<html>shell</html>");
    await finalizeOutput(dir);
    expect(fs.readFileSync(path.join(dir, "index.html"), "utf-8")).toBe(
      "<html>shell</html>",
    );
  });

  it("does not overwrite an existing index.html", async () => {
    fs.writeFileSync(path.join(dir, "_shell.html"), "<html>shell</html>");
    fs.writeFileSync(path.join(dir, "index.html"), "<html>real</html>");
    await finalizeOutput(dir);
    expect(fs.readFileSync(path.join(dir, "index.html"), "utf-8")).toBe(
      "<html>real</html>",
    );
  });

  it("fails with a descriptive error when the shell is missing", () => {
    expect(() => finalizeOutput(dir)).toThrow(/_shell\.html missing/);
  });
});
