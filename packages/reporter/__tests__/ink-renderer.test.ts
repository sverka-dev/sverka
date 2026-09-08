import { describe, it, expect, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { createInkRenderer } from "../src/ink-renderer.js";
import type { InkRenderer } from "../src/types.js";
import {
  runStarted,
  stepPending,
  stepStarted,
  stepSucceeded,
  stepFailed,
  runCompleted,
} from "./helpers/fixtures.js";
import type { Finding, PolicyResult } from "@sverka/verification";

class FakeStdout extends EventEmitter {
  columns = 100;
  rows = 30;
  isTTY = true;
  readonly frames: string[] = [];
  write = (frame: string): boolean => {
    this.frames.push(frame);
    return true;
  };
  lastFrame(): string {
    return this.frames.at(-1) ?? "";
  }
}

class FakeStdin extends EventEmitter {
  isTTY: boolean;
  private data: string | null = null;
  constructor(isTTY = true) {
    super();
    this.isTTY = isTTY;
  }
  write = (data: string): void => {
    this.data = data;
    this.emit("readable");
    this.emit("data", data);
  };
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read = (): string | null => {
    const { data } = this;
    this.data = null;
    return data;
  };
}

const PASS: PolicyResult = {
  verdict: "pass",
  triggered: [],
  rules: [],
  summary: "pass: no findings triggered any rule",
};

const FAIL: PolicyResult = {
  verdict: "fail",
  triggered: [],
  rules: [],
  summary: "fail: 1 finding triggered 1 rule (1 high)",
};

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: `ci/lint:${overrides.fingerprint ?? "fp1"}`,
    fingerprint: overrides.fingerprint ?? "fp1",
    checkId: overrides.checkId ?? "ci/lint",
    severity: overrides.severity ?? "high",
    confidence: 0.5,
    message: overrides.message ?? "test finding",
    rule: overrides.rule ?? "rule-1",
    file: overrides.file ?? "src/index.ts",
    startLine: overrides.startLine ?? 10,
    endLine: overrides.endLine ?? 10,
    source: {
      tool: "test",
      version: null,
      format: "sarif",
      originalRuleId: "rule-1",
      originalSeverity: overrides.source?.originalSeverity ?? null,
    },
    ...overrides,
  };
}

const active: { renderer: InkRenderer | null; stdin: FakeStdin | null } = {
  renderer: null,
  stdin: null,
};

function mount(opts: { tty?: boolean } = {}) {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin(opts.tty ?? true);
  const renderer = createInkRenderer({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    interactive: true,
    debug: true,
  });
  active.renderer = renderer;
  active.stdin = stdin;
  return { renderer, stdout, stdin };
}

async function waitFor(
  stdout: FakeStdout,
  needle: string,
  timeoutMs = 4000,
): Promise<string> {
  return waitUntil(stdout, (f) => f.includes(needle), timeoutMs, `contain ${JSON.stringify(needle)}`);
}

async function waitUntil(
  stdout: FakeStdout,
  pred: (frame: string) => boolean,
  timeoutMs = 4000,
  desc = "condition",
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frame = stdout.lastFrame();
    if (pred(frame)) return frame;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    `frame never satisfied ${desc}; last frame:\n${stdout.lastFrame()}`,
  );
}

async function quit(stdin: FakeStdin, renderer: InkRenderer): Promise<void> {
  // Escape exits search mode if active; ink buffers a lone Escape briefly
  // (pending-alt detection), so let it flush before sending q.
  stdin.write("\u001B");
  await new Promise((r) => setTimeout(r, 150));
  stdin.write("q");
  await Promise.race([
    renderer.waitUntilExit(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("quit timeout")), 3000)),
  ]);
}

afterEach(async () => {
  if (active.renderer && active.stdin) {
    // Ensure the app is torn down even if the test didn't quit.
    // Escape first in case search mode is active (q would type into it).
    active.stdin.write("\u001B");
    await new Promise((r) => setTimeout(r, 150));
    active.stdin.write("q");
    await Promise.race([
      active.renderer.waitUntilExit(),
      new Promise((r) => setTimeout(r, 1000)),
    ]).catch(() => {});
    active.renderer = null;
    active.stdin = null;
  }
});

describe("InkRenderer", () => {
  it("12. mount returns a Renderer with waitUntilExit", async () => {
    const { renderer, stdin } = mount();
    expect(typeof renderer.onEvent).toBe("function");
    expect(typeof renderer.waitUntilExit).toBe("function");
    await quit(stdin, renderer);
  });

  it("13. step events render step ids and status glyphs", async () => {
    const { renderer, stdout, stdin } = mount();
    renderer.onEvent(runStarted("r1", "plan-1"));
    renderer.onEvent(stepPending("ci/lint"));
    await waitFor(stdout, "ci/lint");
    await waitFor(stdout, "plan-1");
    await quit(stdin, renderer);
  });

  it("14. findings list renders finding rows", async () => {
    const { renderer, stdout, stdin } = mount();
    renderer.onEvent(runStarted("r1", "plan-1"));
    renderer.onFindings([
      makeFinding({ message: "unique-msg-xyz", file: "src/a.ts" }),
    ]);
    await waitFor(stdout, "unique-msg-xyz");
    await waitFor(stdout, "src/a.ts");
    await quit(stdin, renderer);
  });

  it("15. filter bar contains all filter labels", async () => {
    const { renderer, stdout, stdin } = mount();
    renderer.onEvent(runStarted("r1", "plan-1"));
    const frame = await waitFor(stdout, "[all]");
    for (const f of ["[high]", "[medium]", "[low]", "[new]", "[error]"]) {
      expect(frame).toContain(f);
    }
    await quit(stdin, renderer);
  });

  it("16. verdict footer shows pass and fail", async () => {
    const a = mount();
    a.renderer.onEvent(runStarted("r1", "p"));
    a.renderer.onVerdict(FAIL);
    await waitFor(a.stdout, "Policy: FAIL");
    await quit(a.stdin, a.renderer);

    const b = mount();
    b.renderer.onEvent(runStarted("r2", "p"));
    b.renderer.onVerdict(PASS);
    await waitFor(b.stdout, "Policy: PASS");
    await quit(b.stdin, b.renderer);
  });

  it("17. f cycles filter, j/k move selection, d toggles details", async () => {
    const { renderer, stdout, stdin } = mount();
    renderer.onEvent(runStarted("r1", "p"));
    renderer.onEvent(stepFailed("ci/a", "boom", 10));
    renderer.onEvent(stepSucceeded("ci/b", 5));
    renderer.onFindings([
      makeFinding({ severity: "high", fingerprint: "h1", message: "high-one" }),
      makeFinding({ severity: "low", fingerprint: "l1", message: "low-one" }),
    ]);
    await waitFor(stdout, "high-one");

    // f: all -> high — low finding disappears
    stdin.write("f");
    await waitUntil(
      stdout,
      (f) => f.includes("high-one") && !f.includes("low-one"),
      4000,
      "high filter applied",
    );

    // j then d: select ci/b? selection moves then details pane opens
    stdin.write("j");
    stdin.write("d");
    await waitFor(stdout, "(no details)");

    // k back up then d: details for failed step show the error
    stdin.write("k");
    stdin.write("d"); // close ci/b details
    stdin.write("d"); // open ci/a details
    await waitFor(stdout, "boom");

    await quit(stdin, renderer);
  });

  it("18. / enters search mode and narrows findings", async () => {
    const { renderer, stdout, stdin } = mount();
    renderer.onEvent(runStarted("r1", "p"));
    renderer.onFindings([
      makeFinding({ message: "alpha-finding", fingerprint: "a" }),
      makeFinding({ message: "beta-finding", fingerprint: "b" }),
    ]);
    await waitFor(stdout, "alpha-finding");

    stdin.write("/");
    stdin.write("beta");
    await waitUntil(
      stdout,
      (f) => f.includes("beta-finding") && !f.includes("alpha-finding"),
      4000,
      "search narrowed findings",
    );

    await quit(stdin, renderer);
  });

  it("19. q resolves waitUntilExit", async () => {
    const { renderer, stdin } = mount();
    renderer.onEvent(runStarted("r1", "p"));
    stdin.write("q");
    await expect(renderer.waitUntilExit()).resolves.toBeUndefined();
  });

  it("20. non-TTY stdin: flush resolves waitUntilExit without input", async () => {
    const { renderer } = mount({ tty: false });
    renderer.onEvent(runStarted("r1", "p"));
    renderer.onEvent(stepStarted("ci/a"));
    renderer.onEvent(stepSucceeded("ci/a", 10));
    renderer.flush();
    await expect(renderer.waitUntilExit()).resolves.toBeUndefined();
    active.stdin = null; // nothing to quit in afterEach
  });

  it("21. resize re-renders within new dimensions", async () => {
    const { renderer, stdout, stdin } = mount();
    renderer.onEvent(runStarted("r1", "p"));
    renderer.onEvent(stepSucceeded("ci/a", 5));
    await waitFor(stdout, "ci/a");
    stdout.columns = 40;
    stdout.rows = 10;
    stdout.emit("resize");
    // Force a re-render after resize; the component reads the new
    // dimensions without throwing.
    renderer.onEvent(stepStarted("ci/a"));
    const frame = await waitFor(stdout, "ci/a");
    expect(frame).toContain("ci/a");
    await quit(stdin, renderer);
  });

  it("step lifecycle transitions update the frame", async () => {
    const { renderer, stdout, stdin } = mount();
    renderer.onEvent(runStarted("r1", "p"));
    renderer.onEvent(stepPending("ci/a"));
    await waitFor(stdout, "ci/a");
    renderer.onEvent(stepStarted("ci/a"));
    renderer.onEvent(stepSucceeded("ci/a", 42));
    const frame = await waitFor(stdout, "42ms");
    expect(frame).toContain("ci/a");
    renderer.onEvent(runCompleted("r1", "success", 100));
    await waitFor(stdout, "success");
    await quit(stdin, renderer);
  });
});
