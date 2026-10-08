// Spec 54 test 5 — sverka apply validates sverka-writes.json against the
// step's declared WriteDeclaration[] (SVERKA_WRITE_DECLARATIONS) and
// fails loudly on undeclared/unsupported/malformed writes. Provider
// calls are stubbed at fetch — validation runs before any request.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { applyCommand } from "../commands/apply.js";
import { ExitCode } from "../types.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
} from "./helpers/fixtures.js";

const DECL_ENV = "SVERKA_WRITE_DECLARATIONS";
const ENV_KEYS = [
  DECL_ENV,
  "GITLAB_CI",
  "CI_API_V4_URL",
  "CI_PROJECT_ID",
  "SVERKA_APPLY_TOKEN",
  "GITLAB_TOKEN",
  "GITHUB_ACTIONS",
  "GITHUB_REPOSITORY",
  "GITHUB_API_URL",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "MR_IID",
  "ISSUE_IID",
  "SVERKA_ISSUE_IID",
] as const;

describe("sverka apply — writes validation (Spec 54)", () => {
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await makeTempDir();
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await cleanupTempDir(dir);
  });

  const global = () => ({
    root: dir,
    format: "text" as const,
    config: null,
    quiet: false,
    verbose: false,
  });
  const gitlabEnv = () => {
    process.env.CI_PROJECT_ID = "123";
    process.env.SVERKA_APPLY_TOKEN = "glpat-test";
    process.env.MR_IID = "7";
  };

  it("fails when the writes artifact is missing", async () => {
    const out = new CaptureWriter();
    await expect(
      applyCommand({ provider: "gitlab" }, global(), out, 0),
    ).rejects.toThrow(/writes artifact not found/);
  });

  it("fails when the artifact is not valid JSON", async () => {
    await writeFile(join(dir, "sverka-writes.json"), "not json{", "utf-8");
    await expect(
      applyCommand({ provider: "gitlab" }, global(), new CaptureWriter(), 0),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("fails when SVERKA_WRITE_DECLARATIONS is not set", async () => {
    await writeFile(
      join(dir, "sverka-writes.json"),
      JSON.stringify({ writes: [] }),
      "utf-8",
    );
    await expect(
      applyCommand({ provider: "gitlab" }, global(), new CaptureWriter(), 0),
    ).rejects.toThrow(/SVERKA_WRITE_DECLARATIONS is not set/);
  });

  it("test 5: a write kind not in WriteDeclaration[] fails loudly", async () => {
    await writeFile(
      join(dir, "sverka-writes.json"),
      JSON.stringify({
        writes: [{ kind: "push", ref: "main" }],
      }),
      "utf-8",
    );
    process.env[DECL_ENV] = JSON.stringify([
      { kind: "comment", target: "merge_request" },
    ]);
    gitlabEnv();
    await expect(
      applyCommand({ provider: "gitlab" }, global(), new CaptureWriter(), 0),
    ).rejects.toThrow(/write kind 'push' is not declared/);
  });

  it("a declared but unsupported kind fails loudly", async () => {
    await writeFile(
      join(dir, "sverka-writes.json"),
      JSON.stringify({ writes: [{ kind: "deploy", env: "prod" }] }),
      "utf-8",
    );
    process.env[DECL_ENV] = JSON.stringify([
      { kind: "deploy", target: "prod" },
    ]);
    gitlabEnv();
    await expect(
      applyCommand({ provider: "gitlab" }, global(), new CaptureWriter(), 0),
    ).rejects.toThrow(/declared but not supported/);
  });

  it("malformed writes entries fail loudly", async () => {
    await writeFile(
      join(dir, "sverka-writes.json"),
      JSON.stringify({ writes: [{ no_kind: true }] }),
      "utf-8",
    );
    process.env[DECL_ENV] = "[]";
    await expect(
      applyCommand({ provider: "gitlab" }, global(), new CaptureWriter(), 0),
    ).rejects.toThrow(/writes\[0\] must be an object/);
  });

  it("gitlab provider: missing CI_PROJECT_ID fails before the request", async () => {
    await writeFile(
      join(dir, "sverka-writes.json"),
      JSON.stringify({ writes: [{ kind: "comment", body: "hi" }] }),
      "utf-8",
    );
    process.env[DECL_ENV] = JSON.stringify([
      { kind: "comment", target: "merge_request" },
    ]);
    process.env.SVERKA_APPLY_TOKEN = "glpat-test";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      applyCommand({ provider: "gitlab" }, global(), new CaptureWriter(), 0),
    ).rejects.toThrow(/CI_PROJECT_ID is not set/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("gitlab provider: missing apply token fails before the request", async () => {
    await writeFile(
      join(dir, "sverka-writes.json"),
      JSON.stringify({ writes: [{ kind: "comment", body: "hi" }] }),
      "utf-8",
    );
    process.env[DECL_ENV] = JSON.stringify([
      { kind: "comment", target: "merge_request" },
    ]);
    process.env.CI_PROJECT_ID = "123";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      applyCommand({ provider: "gitlab" }, global(), new CaptureWriter(), 0),
    ).rejects.toThrow(/SVERKA_APPLY_TOKEN is not set/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("applies a declared comment write to a GitLab MR note", async () => {
    await writeFile(
      join(dir, "sverka-writes.json"),
      JSON.stringify({
        writes: [{ kind: "comment", body: "looks good" }],
      }),
      "utf-8",
    );
    process.env[DECL_ENV] = JSON.stringify([
      { kind: "comment", target: "merge_request" },
    ]);
    gitlabEnv();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    const out = new CaptureWriter();
    const code = await applyCommand({ provider: "gitlab" }, global(), out, 0);
    expect(code).toBe(ExitCode.Success);
    const [url, init] = fetchSpy.mock.calls[0]! as unknown as [
      string,
      { method: string; headers: Record<string, string> },
    ];
    expect(url).toBe(
      "https://gitlab.com/api/v4/projects/123/merge_requests/7/notes",
    );
    expect(init.method).toBe("POST");
    expect(init.headers["PRIVATE-TOKEN"]).toBe("glpat-test");
    expect(out.stdoutText).toContain("applied 1 write(s)");
  });

  it("applies a declared comment write to a GitLab issue when MR_IID is absent", async () => {
    await writeFile(
      join(dir, "sverka-writes.json"),
      JSON.stringify({
        writes: [{ kind: "comment", body: "welcome", on: "issue", iid: 4 }],
      }),
      "utf-8",
    );
    process.env[DECL_ENV] = JSON.stringify([
      { kind: "comment", target: "issue" },
    ]);
    process.env.CI_PROJECT_ID = "123";
    process.env.SVERKA_APPLY_TOKEN = "glpat-test";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    const code = await applyCommand(
      { provider: "gitlab" },
      global(),
      new CaptureWriter(),
      0,
    );
    expect(code).toBe(ExitCode.Success);
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "https://gitlab.com/api/v4/projects/123/issues/4/notes",
    );
  });

  it("auto-detects the gitlab provider from CI env", async () => {
    await writeFile(
      join(dir, "sverka-writes.json"),
      JSON.stringify({ writes: [] }),
      "utf-8",
    );
    process.env[DECL_ENV] = "[]";
    process.env.GITLAB_CI = "true";
    const out = new CaptureWriter();
    const code = await applyCommand({}, global(), out, 0);
    expect(code).toBe(ExitCode.Success);
    expect(out.stdoutText).toContain("via gitlab");
  });

  it("provider detection failure is a usage error", async () => {
    await writeFile(
      join(dir, "sverka-writes.json"),
      JSON.stringify({ writes: [] }),
      "utf-8",
    );
    process.env[DECL_ENV] = "[]";
    await expect(
      applyCommand({}, global(), new CaptureWriter(), 0),
    ).rejects.toThrow(/--provider is required/);
  });
});
