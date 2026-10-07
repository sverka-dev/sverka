// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountRunner } from "../src/index.js";
import type { PipelineResult } from "../src/index.js";

const SIMPLE = `import { Project, Pipeline, FunctionStep, Entry } from "@sverka/playground";

const proj = new Project("demo");
const checks = new Pipeline(proj, "checks");
new FunctionStep(checks, "lint", {
  fn: () => [
    { rule: "r1", file: "a.ts", line: 1, severity: "high", message: "boom" },
  ],
});
new Entry(checks, "on-push", { trigger: { kind: "push" }, roots: ["lint"] });
export default proj;
`;

function once<T>(fn: (cb: (v: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve) => fn(resolve));
}

describe("mountRunner (spec 53.4)", () => {
  it("runs the mounted code on load and fires onRun exactly once", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    let calls = 0;
    const result = await once<PipelineResult>((cb) =>
      mountRunner(el, {
        code: SIMPLE,
        autoRun: true,
        onRun: (r) => {
          calls++;
          cb(r);
        },
      }),
    );
    // Settle any stray follow-up invocations before asserting the count.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(1);
    expect(result.steps).toHaveLength(1);
    expect(result.findings).toHaveLength(1);
    expect(el.querySelector("iframe")?.getAttribute("srcdoc")).toContain(
      "boom",
    );
  });

  it("does not auto-execute code unless autoRun is set", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    let calls = 0;
    mountRunner(el, { code: SIMPLE, onRun: () => calls++ });
    expect(calls).toBe(0);
    expect(el.querySelector("iframe")?.getAttribute("srcdoc")).toBeNull();
  });

  it("readonly mode renders a listing, not an editable field", async () => {
    const el = document.createElement("div");
    const result = await once<PipelineResult>((cb) =>
      mountRunner(el, {
        code: SIMPLE,
        readonly: true,
        autoRun: true,
        onRun: cb,
      }),
    );
    expect(el.querySelector("pre")?.textContent).toBe(SIMPLE);
    expect(el.querySelector("textarea")).toBeNull();
    expect(result.findings).toHaveLength(1);
  });

  it("dispose() removes the mount", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const mounted = mountRunner(el, {
      code: SIMPLE,
      onRun: () => {},
    });
    expect(el.childElementCount).toBe(1);
    mounted.dispose();
    expect(el.childElementCount).toBe(0);
  });
});
