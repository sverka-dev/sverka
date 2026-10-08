// Docs embed test (Spec 53, test plan item 10): the Runner component mounts
// @sverka/playground's mountRunner with the example preloaded and disposes
// on unmount. Uses the real package — not a mock — so the test is the docs
// embed contract end to end.
import { describe, it, expect, afterEach } from "bun:test";
import { Window } from "happy-dom";

// happy-dom v20 registers nothing automatically — expose every window
// property the host lacks (process/console/etc. stay native).
const window = new Window({ url: "https://localhost/" });
const KEEP_NATIVE = new Set([
  "process",
  "console",
  "Buffer",
  "module",
  "require",
  "global",
  "globalThis",
]);
for (const key of Object.getOwnPropertyNames(window)) {
  if (KEEP_NATIVE.has(key) || key in globalThis) continue;
  const descriptor = Object.getOwnPropertyDescriptor(window, key);
  if (descriptor) Object.defineProperty(globalThis, key, descriptor);
}
(globalThis as { window: unknown }).window = window;
(globalThis as { document: unknown }).document = window.document;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Runner } = await import("../src/components/runner");
const { getMDXComponents } = await import("../src/components/mdx");

const CODE = `import { Project, Pipeline, FunctionStep, Entry } from "@sverka/playground";

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

/** Flush inside act until `cond` holds — the runner mounts after a
 *  dynamic import resolves, which a fixed tick can race. */
async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    if (cond()) return;
  }
  throw new Error("waitFor timed out");
}

const roots: { unmount(): void }[] = [];

afterEach(async () => {
  await act(async () => {
    while (roots.length > 0) roots.pop()?.unmount();
  });
  window.document.body.innerHTML = "";
});

describe("Runner (docs embed, spec 53.4)", () => {
  it("mounts mountRunner with the example preloaded", async () => {
    const host = window.document.createElement("div");
    window.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);
    roots.push(root);
    await act(async () => {
      root.render(<Runner code={CODE} />);
    });
    await waitFor(() => host.querySelector("textarea") !== null);

    const codeEl = host.querySelector("textarea");
    expect(codeEl).not.toBeNull();
    expect((codeEl as unknown as HTMLTextAreaElement).value).toBe(CODE);
    expect(host.querySelector("button")?.textContent).toBe("Run");
    expect(host.querySelector("iframe")).not.toBeNull();
  });

  it("autoRun produces a findings report", async () => {
    const host = window.document.createElement("div");
    window.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);
    roots.push(root);
    await act(async () => {
      root.render(<Runner code={CODE} autoRun />);
    });
    await waitFor(
      () =>
        host
          .querySelector("iframe")
          ?.getAttribute("srcdoc")
          ?.includes("boom") ?? false,
    );

    const frame = host.querySelector("iframe");
    expect(frame?.getAttribute("srcdoc")).toContain("boom");
    expect(host.querySelector("button")?.textContent).toBe("Run");
  });

  it("dispose removes the mount on unmount", async () => {
    const host = window.document.createElement("div");
    window.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);
    await act(async () => {
      root.render(<Runner code={CODE} />);
    });
    await waitFor(() => host.childElementCount === 1);
    expect(host.childElementCount).toBe(1);

    await act(async () => {
      root.unmount();
    });
    expect(host.childElementCount).toBe(0);
  });

  it("is registered as an MDX component", () => {
    const components = getMDXComponents();
    expect(components.Runner).toBe(Runner);
  });
});
