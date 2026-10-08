// Spec 55 — remote run hub: login credentials, `--remote` run wiring
// (degradation + upload), and `runs --remote` listing. The hub side is
// the real @sverka/hub server on an ephemeral port.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { main } from "../index.js";
import { startHubServer, type HubServer } from "@sverka/hub";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  writefile,
} from "./helpers/fixtures.js";

const CONFIG = `import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
const proj = new Project("myproj");
const pipeline = new Pipeline(proj, "ci");
new ShellStep(pipeline, "build", { command: "mkdir -p cached-out && echo payload > cached-out/out.txt", runtime: { shell: "sh" }, cache: { key: "build-linux-main", paths: ["cached-out"], restoreKeys: ["build-linux-"] } });
new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
export default proj;
`;

const RW_TOKEN = "svk_test_writertoken";

function useTempDir(prefix = "sverka-remote-test-") {
  let dir = "";
  beforeEach(async () => {
    dir = await makeTempDir(prefix);
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });
  return () => dir;
}

/** Redirect the credentials file into a throwaway HOME/XDG dir per test. */
function useIsolatedConfigHome() {
  let home = "";
  const saved: Record<string, string | undefined> = {};
  const names = ["XDG_CONFIG_HOME", "SVERKA_HUB_URL", "SVERKA_HUB_TOKEN"];
  beforeEach(async () => {
    home = await makeTempDir("sverka-cfg-");
    for (const n of names) saved[n] = process.env[n];
    process.env["XDG_CONFIG_HOME"] = join(home, "xdg");
    delete process.env["SVERKA_HUB_URL"];
    delete process.env["SVERKA_HUB_TOKEN"];
  });
  afterEach(async () => {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
    await cleanupTempDir(home);
  });
}

describe("sverka login", () => {
  useIsolatedConfigHome();

  it("writes ~/.config/sverka/credentials with mode 0600", async () => {
    const out = new CaptureWriter();
    const code = await main(
      ["login", "--hub", "http://hub.local:7357", "--token", "svk_abc12345"],
      { output: out },
    );
    expect(code).toBe(0);
    const path = join(
      process.env["XDG_CONFIG_HOME"] ?? "",
      "sverka",
      "credentials",
    );
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      hubs: Record<string, string>;
    };
    expect(parsed.hubs["http://hub.local:7357"]).toBe("svk_abc12345");
  });

  it("fails with usage error when --hub is missing", async () => {
    const out = new CaptureWriter();
    const code = await main(["login", "--token", "svk_abc12345"], {
      output: out,
    });
    expect(code).toBe(2);
    expect(out.stderrText).toContain("--hub");
  });

  it("env vars supply hub and token", async () => {
    process.env["SVERKA_HUB_URL"] = "http://env.hub:1";
    process.env["SVERKA_HUB_TOKEN"] = "svk_envtoken";
    const out = new CaptureWriter();
    const code = await main(["login"], { output: out });
    expect(code).toBe(0);
    const path = join(
      process.env["XDG_CONFIG_HOME"] ?? "",
      "sverka",
      "credentials",
    );
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      hubs: Record<string, string>;
    };
    expect(parsed.hubs["http://env.hub:1"]).toBe("svk_envtoken");
  });
});

describe("sverka run --remote", () => {
  const getDir = useTempDir();
  useIsolatedConfigHome();

  it("errors with a login hint when no hub is configured", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", CONFIG);
    const out = new CaptureWriter();
    const code = await main(["run", "--root", dir, "--remote"], {
      output: out,
    });
    expect(code).toBe(2);
    expect(out.stderrText).toContain("sverka login");
  });

  it("hub down: run completes, warns remote.upload-failed, exit code is the run verdict", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", CONFIG);
    // Nothing listens here — connection refused.
    process.env["SVERKA_HUB_URL"] = "http://127.0.0.1:1";
    process.env["SVERKA_HUB_TOKEN"] = "svk_dead";
    const out = new CaptureWriter();
    const code = await main(
      ["run", "--root", dir, "--remote", "--format", "text"],
      { output: out },
    );
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("run completed");
    expect(out.stderrText).toContain("remote.upload-failed");
  }, 30_000);

  it("end-to-end: real hub gets the run + serves the remote cache", async () => {
    const dir = getDir();
    await writefile(dir, "sverka.config.ts", CONFIG);
    const dataDir = await makeTempDir("sverka-hub-data-");
    let hub: HubServer | undefined;
    try {
      hub = await startHubServer({
        dataDir,
        port: 0,
        host: "127.0.0.1",
        tokens: [{ name: "t", token: RW_TOKEN, access: "rw" }],
      });
      process.env["SVERKA_HUB_URL"] = hub.url;
      process.env["SVERKA_HUB_TOKEN"] = RW_TOKEN;
      await writefile(
        dir,
        ".sverka/hub.json",
        JSON.stringify({ project: "test/repo" }),
      );

      const out = new CaptureWriter();
      const code = await main(["run", "--root", dir, "--remote"], {
        output: out,
      });
      expect(code).toBe(0);

      // The run report landed on the hub under the project namespace.
      const list = await fetch(
        `${hub.url}/v1/runs?project=${encodeURIComponent("test/repo")}`,
        { headers: { authorization: `Bearer ${RW_TOKEN}` } },
      );
      const runs = (await list.json()) as { runId: string }[];
      expect(runs.length).toBe(1);

      // And the step's cache blob was pushed.
      const blob = await fetch(
        `${hub.url}/v1/cache/${encodeURIComponent("test/repo")}/build-linux-main`,
        { headers: { authorization: `Bearer ${RW_TOKEN}` } },
      );
      expect(blob.status).toBe(200);
      expect((await blob.arrayBuffer()).byteLength).toBeGreaterThan(0);
    } finally {
      await hub?.close();
      await cleanupTempDir(dataDir);
    }
  }, 30_000);
});

describe("sverka runs --remote", () => {
  const getDir = useTempDir("sverka-runs-test-");
  useIsolatedConfigHome();

  it("lists remote runs; without config it is a usage error", async () => {
    const dir = getDir();
    const noHub = new CaptureWriter();
    const bad = await main(["runs", "--remote", "--root", dir], {
      output: noHub,
    });
    expect(bad).toBe(2);

    const dataDir = await makeTempDir("sverka-hub-data-");
    let hub: HubServer | undefined;
    try {
      hub = await startHubServer({
        dataDir,
        port: 0,
        host: "127.0.0.1",
        tokens: [{ name: "t", token: RW_TOKEN, access: "rw" }],
      });
      await fetch(`${hub.url}/v1/runs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${RW_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          project: "test/repo",
          entry: "ci/on-push",
          runId: "listed-run",
          report: {
            schema: "sverka.run/v1",
            data: { status: "success", steps: [] },
          },
          findings: [],
        }),
      });
      process.env["SVERKA_HUB_URL"] = hub.url;
      process.env["SVERKA_HUB_TOKEN"] = RW_TOKEN;
      await writefile(
        dir,
        ".sverka/hub.json",
        JSON.stringify({ project: "test/repo" }),
      );
      const out = new CaptureWriter();
      const code = await main(["runs", "--remote", "--root", dir], {
        output: out,
      });
      expect(code).toBe(0);
      expect(out.stdoutText).toContain("listed-run");
      expect(out.stdoutText).toContain("ci/on-push");
    } finally {
      await hub?.close();
      await cleanupTempDir(dataDir);
    }
  }, 30_000);
});
