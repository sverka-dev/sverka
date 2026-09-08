import { describe, it, expect } from "bun:test";
import { readJsonFile, writeJsonFile, combineFiles } from "../src/index";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmp = mkdtempSync(join(tmpdir(), "refactor-async-test-"));

describe("readJsonFile", () => {
  it("reads and parses JSON", async () => {
    const path = join(tmp, "read-test.json");
    writeFileSync(path, '{"key":"value"}', "utf-8");
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        readJsonFile(path, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });
      expect(result).toEqual({ key: "value" });
    } finally {
      unlinkSync(path);
    }
  });
});

describe("writeJsonFile", () => {
  it("writes JSON to file", async () => {
    const path = join(tmp, "write-test.json");
    try {
      await new Promise<void>((resolve, reject) => {
        writeJsonFile(path, { key: "value" }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      expect(existsSync(path)).toBe(true);
    } finally {
      if (existsSync(path)) unlinkSync(path);
    }
  });
});

describe("combineFiles", () => {
  it("combines multiple JSON files", async () => {
    const paths = [join(tmp, "a.json"), join(tmp, "b.json")];
    writeFileSync(paths[0]!, "1", "utf-8");
    writeFileSync(paths[1]!, "2", "utf-8");
    try {
      const result = await new Promise<unknown[]>((resolve, reject) => {
        combineFiles(paths, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });
      expect(result).toEqual([1, 2]);
    } finally {
      paths.forEach((p) => existsSync(p) && unlinkSync(p));
    }
  });
});
