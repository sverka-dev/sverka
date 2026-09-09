import { describe, it, expect, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { render } from "ink";
import { createElement } from "react";
import { SarifTuiApp } from "../src/viewer.js";
import type { Finding } from "@sverka/verification";
import { makeFinding } from "./helpers/fixtures.js";

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
  isTTY = true;
  private data: string | null = null;
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

const active: { instance: ReturnType<typeof render> | null; stdin: FakeStdin | null } = {
  instance: null,
  stdin: null,
};

function mount(findings: readonly Finding[]) {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  const instance = render(createElement(SarifTuiApp, { findings }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    exitOnCtrlC: false,
    debug: true,
  });
  active.instance = instance;
  active.stdin = stdin;
  return { instance, stdout, stdin };
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
  throw new Error(`frame never satisfied ${desc}; last frame:\n${stdout.lastFrame()}`);
}

async function quit(stdin: FakeStdin, instance: ReturnType<typeof render>): Promise<void> {
  stdin.write("\u001B");
  await new Promise((r) => setTimeout(r, 150));
  stdin.write("q");
  await Promise.race([
    instance.waitUntilExit(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("quit timeout")), 3000)),
  ]);
}

afterEach(async () => {
  if (active.instance && active.stdin) {
    active.stdin.write("\u001B");
    await new Promise((r) => setTimeout(r, 150));
    active.stdin.write("q");
    await Promise.race([
      active.instance.waitUntilExit(),
      new Promise((r) => setTimeout(r, 1000)),
    ]).catch(() => {});
    active.instance = null;
    active.stdin = null;
  }
});

describe("SarifTuiApp", () => {
  it("renders findings list from Finding[]", async () => {
    const { stdout, stdin, instance } = mount([
      makeFinding({ fingerprint: "a", message: "alpha-msg" }),
      makeFinding({ fingerprint: "b", message: "beta-msg" }),
    ]);
    const frame = await waitFor(stdout, "alpha-msg");
    expect(frame).toContain("alpha-msg");
    expect(frame).toContain("beta-msg");
    await quit(stdin, instance);
  });

  it("filter bar contains all 6 severity labels", async () => {
    const { stdout, stdin, instance } = mount([makeFinding()]);
    const frame = await waitFor(stdout, "[all]");
    for (const f of ["[critical]", "[high]", "[medium]", "[low]", "[info]"]) {
      expect(frame).toContain(f);
    }
    await quit(stdin, instance);
  });

  it("f cycles filter through 6 levels", async () => {
    const { stdout, stdin, instance } = mount([
      makeFinding({ fingerprint: "a", severity: "high", message: "high-one" }),
      makeFinding({ fingerprint: "b", severity: "low", message: "low-one" }),
    ]);
    await waitFor(stdout, "high-one");

    // f: all -> critical (no findings match)
    stdin.write("f");
    const criticalFrame = await waitUntil(
      stdout,
      (f) => f.includes("[critical]") && !f.includes("high-one"),
      4000,
      "critical filter",
    );
    expect(criticalFrame).toContain("No findings");

    // f: critical -> high (only high-one)
    stdin.write("f");
    const highFrame = await waitUntil(
      stdout,
      (f) => f.includes("[high]") && f.includes("high-one") && !f.includes("low-one"),
      4000,
      "high filter",
    );
    expect(highFrame).toContain("high-one");
    expect(highFrame).not.toContain("low-one");

    await quit(stdin, instance);
  });

  it("search filters findings by text match", async () => {
    const { stdout, stdin, instance } = mount([
      makeFinding({ fingerprint: "a", message: "alpha-finding" }),
      makeFinding({ fingerprint: "b", message: "beta-finding" }),
    ]);
    await waitFor(stdout, "alpha-finding");

    stdin.write("/");
    stdin.write("beta");
    const searchFrame = await waitUntil(
      stdout,
      (f) => f.includes("beta-finding") && !f.includes("alpha-finding"),
      4000,
      "search narrowed",
    );
    expect(searchFrame).toContain("beta-finding");
    expect(searchFrame).not.toContain("alpha-finding");

    await quit(stdin, instance);
  });

  it("sort cycles: none -> severity -> file -> rule -> none", async () => {
    const { stdout, stdin, instance } = mount([
      makeFinding({ fingerprint: "a", severity: "low", file: "z.ts", rule: "rule-z", message: "aaa" }),
      makeFinding({ fingerprint: "b", severity: "high", file: "a.ts", rule: "rule-a", message: "bbb" }),
    ]);
    await waitFor(stdout, "aaa");

    // Initial order: aaa (low) first, bbb (high) second
    // s: none -> severity (high first)
    stdin.write("s");
    const sevFrame = await waitUntil(
      stdout,
      (f) => {
        const aIdx = f.indexOf("bbb");
        const bIdx = f.indexOf("aaa");
        return aIdx > -1 && bIdx > -1 && aIdx < bIdx;
      },
      4000,
      "severity sort (high first)",
    );
    expect(sevFrame).toContain("bbb");

    await quit(stdin, instance);
  });

  it("detail panel shows selected finding's rule, file, line range, message", async () => {
    const { stdout, stdin, instance } = mount([
      makeFinding({
        fingerprint: "a",
        rule: "no-undef",
        file: "src/x.ts",
        startLine: 10,
        endLine: 20,
        message: "undefined variable",
        helpUrl: "https://example.com/rule",
      }),
    ]);
    await waitFor(stdout, "undefined variable");

    stdin.write("d");
    const detailsFrame = await waitFor(stdout, "rule: no-undef");
    expect(detailsFrame).toContain("file: src/x.ts");
    expect(detailsFrame).toContain("lines: 10–20");
    expect(detailsFrame).toContain("message: undefined variable");
    expect(detailsFrame).toContain("help: https://example.com/rule");

    await quit(stdin, instance);
  });

  it("empty findings show 'No findings' message", async () => {
    const { stdout, stdin, instance } = mount([]);
    const frame = await waitFor(stdout, "No findings");
    expect(frame).toContain("No findings");
    await quit(stdin, instance);
  });

  it("j/k moves selection through findings list", async () => {
    const { stdout, stdin, instance } = mount([
      makeFinding({ fingerprint: "a", message: "first-msg" }),
      makeFinding({ fingerprint: "b", message: "second-msg" }),
    ]);
    await waitFor(stdout, "first-msg");

    // j moves down to second finding
    stdin.write("j");
    // d opens details for the selected (second) finding
    stdin.write("d");
    const frame = await waitFor(stdout, "rule:");
    expect(frame).toContain("second-msg");

    await quit(stdin, instance);
  });

  it("q resolves waitUntilExit", async () => {
    const { stdin, instance } = mount([makeFinding()]);
    stdin.write("q");
    await expect(instance.waitUntilExit()).resolves.toBeUndefined();
    active.instance = null;
    active.stdin = null;
  });
});
