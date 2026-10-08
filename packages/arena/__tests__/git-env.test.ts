import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture the env handed to the child — prompt suppression is an env
// contract, not observable git behavior.
const execFileMock = vi.hoisted(() =>
  vi.fn<
    (
      cmd: string,
      args: string[],
      opts: { env?: Record<string, string> },
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => void
  >(),
);
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import { git, gitOrThrow } from "../src/internal/git.js";

function lastEnv(): Record<string, string> {
  const env = execFileMock.mock.calls.at(-1)?.[2]?.env;
  if (env === undefined) throw new Error("git() did not pass an env");
  return env;
}

describe("git child env", () => {
  beforeEach(() => {
    execFileMock.mockImplementation((_c, _a, _o, cb) => cb(null, "", ""));
  });

  afterEach(() => {
    execFileMock.mockClear();
    delete process.env["GIT_TERMINAL_PROMPT"];
    delete process.env["GIT_ASKPASS"];
  });

  it("disables credential prompts — GIT_TERMINAL_PROMPT=0, GIT_ASKPASS=''", async () => {
    await git(["--version"]);
    const env = lastEnv();
    expect(env["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(env["GIT_ASKPASS"]).toBe("");
  });

  it("ambient env cannot re-enable prompting", async () => {
    process.env["GIT_TERMINAL_PROMPT"] = "1";
    process.env["GIT_ASKPASS"] = "/usr/bin/ssh-askpass";
    await git(["--version"]);
    const env = lastEnv();
    expect(env["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(env["GIT_ASKPASS"]).toBe("");
  });

  it("opts.env cannot re-enable prompting either", async () => {
    await git(["--version"], {
      env: { GIT_TERMINAL_PROMPT: "1", GIT_ASKPASS: "/usr/bin/askpass" },
    });
    const env = lastEnv();
    expect(env["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(env["GIT_ASKPASS"]).toBe("");
  });

  it("opts.env still passes unrelated vars through", async () => {
    await git(["--version"], { env: { FOO_MARKER: "yes" } });
    expect(lastEnv()["FOO_MARKER"]).toBe("yes");
  });

  it("gitOrThrow redacts a credentialed URL in args and echoed stderr", async () => {
    // git can echo the remote URL raw in messages like
    // "fatal: repository 'https://user:TOKEN@host/x' does not exist" —
    // both channels must be scrubbed (CWE-209).
    execFileMock.mockImplementation((_c, _a, _o, cb) =>
      cb(
        Object.assign(new Error("exit 128"), { code: 128 }),
        "",
        "fatal: repository 'https://user:SECRET-XYZ@example.com/repo.git' does not exist",
      ),
    );
    const err = await gitOrThrow([
      "clone",
      "https://user:SECRET-XYZ@example.com/repo.git",
      "dest",
    ]).then(
      () => {
        throw new Error("expected gitOrThrow to reject");
      },
      (e: unknown) => e as Error,
    );
    expect(err.message).not.toContain("SECRET-XYZ");
    expect(err.message).toContain("https://<redacted>@example.com/repo.git");
  });
});
