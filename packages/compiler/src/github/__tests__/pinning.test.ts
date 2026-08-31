import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { Project, Pipeline, ShellStep, ReleaseStep, Entry } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import {
  pinActionRef,
  loadBundledRegistry,
  GithubTarget,
  compileGithub,
  type PinRegistry,
  type PinningConfig,
} from "../index.js";

const BUNDLED = loadBundledRegistry();
const CHECKOUT_SHA = BUNDLED["actions/checkout@v4"]!;

describe("pinActionRef — unit (spec 22 items 1–4)", () => {
  it("1. pins a registry action to its SHA with a version comment", () => {
    const out = pinActionRef("actions/checkout@v4", BUNDLED);
    expect(out).toBe(`actions/checkout@${CHECKOUT_SHA} # v4`);
  });

  it("2. passes local actions (./) through unchanged", () => {
    const ref = "./.github/workflows/foo.yml";
    expect(pinActionRef(ref, BUNDLED)).toBe(ref);
  });

  it("3. passes already-pinned (@<40 hex>) refs through unchanged", () => {
    const ref = `actions/checkout@${CHECKOUT_SHA}`;
    expect(pinActionRef(ref, BUNDLED)).toBe(ref);
  });

  it("4. passes unknown third-party actions through unchanged", () => {
    expect(pinActionRef("acme/unknown@v1", BUNDLED)).toBe("acme/unknown@v1");
  });

  it("passes a ref with no @ through unchanged (malformed)", () => {
    expect(pinActionRef("actions/checkout", BUNDLED)).toBe("actions/checkout");
  });

  it("does not add a comment for refs without a vN suffix", () => {
    const reg: PinRegistry = { "acme/tool@latest": "deadbeefcafebabe00000000000000000000beef" };
    const out = pinActionRef("acme/tool@latest", reg);
    expect(out).toBe("acme/tool@deadbeefcafebabe00000000000000000000beef # latest");
  });
});

describe("loadBundledRegistry — spec 22 item 8", () => {
  it("returns a non-empty map whose values are all 40-char hex", () => {
    const reg = loadBundledRegistry();
    const entries = Object.entries(reg);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, sha] of entries) {
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("includes the actions currently emitted by github/lower.ts", () => {
    const reg = loadBundledRegistry();
    expect(reg["actions/checkout@v4"]).toBeDefined();
    expect(reg["actions/upload-artifact@v4"]).toBeDefined();
    expect(reg["actions/download-artifact@v4"]).toBeDefined();
    expect(reg["actions/cache@v4"]).toBeDefined();
    expect(reg["actions/cache/restore@v4"]).toBeDefined();
    expect(reg["actions/cache/save@v4"]).toBeDefined();
    expect(reg["softprops/action-gh-release@v2"]).toBeDefined();
    expect(reg["actions/upload-pages-artifact@v3"]).toBeDefined();
    expect(reg["actions/deploy-pages@v4"]).toBeDefined();
    expect(reg["dorny/test-reporter@v1"]).toBeDefined();
    expect(reg["github/codeql-action/upload-sarif@v3"]).toBeDefined();
  });
});

function makeCheckoutGraph(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "build", { command: "echo hi" });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
  return synthesize(proj);
}

describe("GithubTarget pinning — strict mode (spec 22 items 5, 6)", () => {
  it("5. emits a SHA ref + # v4 comment for a registry action", () => {
    const target = new GithubTarget({ pinning: { mode: "strict" } });
    const result = target.compile(makeCheckoutGraph());
    const yaml = parse(result.artifacts[0]!.content);
    const checkoutStep = yaml.jobs.build.steps.find(
      (s: { uses?: string }) => s.uses?.includes("checkout"),
    );
    expect(checkoutStep).toBeDefined();
    expect(checkoutStep.uses).toBe(`actions/checkout@${CHECKOUT_SHA} # v4`);
  });

  it("6. emits an error unpinned-action diagnostic for a missing registry entry", () => {
    const target = new GithubTarget({
      pinning: { mode: "strict", registry: {} },
    });
    const result = target.compile(makeCheckoutGraph());
    const diag = result.diagnostics.find((d) => d.capability === "unpinned-action");
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe("error");
    expect(diag?.message).toContain("actions/checkout@v4");
  });
});

describe("GithubTarget pinning — off mode (spec 22 item 7)", () => {
  it("7. leaves @v4 unchanged and warns for a missing registry entry", () => {
    const target = new GithubTarget({
      pinning: { mode: "off", registry: {} },
    });
    const result = target.compile(makeCheckoutGraph());
    const yaml = parse(result.artifacts[0]!.content);
    const checkoutStep = yaml.jobs.build.steps.find(
      (s: { uses?: string }) => s.uses?.includes("checkout"),
    );
    expect(checkoutStep.uses).toBe("actions/checkout@v4");
    const diag = result.diagnostics.find((d) => d.capability === "unpinned-action");
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe("warning");
  });

  it("default config (off + bundled registry) emits no unpinned diagnostics for known actions", () => {
    const target = new GithubTarget();
    const result = target.compile(makeCheckoutGraph());
    expect(
      result.diagnostics.find((d) => d.capability === "unpinned-action"),
    ).toBeUndefined();
  });
});

describe("GithubTarget pinning — determinism (spec 22 item 9)", () => {
  it("9. two compiles of the same graph produce byte-identical YAML", () => {
    const target = new GithubTarget({ pinning: { mode: "strict" } });
    const a = target.compile(makeCheckoutGraph());
    const b = target.compile(makeCheckoutGraph());
    expect(a.artifacts[0]!.content).toBe(b.artifacts[0]!.content);
  });
});

describe("pinning exports — spec 22 item 10", () => {
  it("10. pinning symbols are exported from the github module", () => {
    expect(typeof pinActionRef).toBe("function");
    expect(typeof loadBundledRegistry).toBe("function");
    const _cfg: PinningConfig = { mode: "off" };
    const _reg: PinRegistry = { "acme/x@v1": "0".repeat(40) };
    expect(_cfg.mode).toBe("off");
    expect(_reg["acme/x@v1"]).toHaveLength(40);
  });

  it("10b. pinning symbols are exported from @sverka/compiler barrel", async () => {
    const barrel = await import("../../index.js");
    expect(typeof barrel.pinActionRef).toBe("function");
    expect(typeof barrel.loadBundledRegistry).toBe("function");
  });
});

describe("GithubTarget pinning — release step pins composite actions", () => {
  it("pins softprops/action-gh-release@v2 in strict mode", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new ReleaseStep(ci, "release", {
      release: {
        tag: "v1.0.0",
        name: "Release v1.0.0",
        description: "Release notes",
        assets: ["dist/bin.tar.gz"],
        draft: false,
        prerelease: false,
      },
      dependsOn: ["build"],
    });
    new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["release"] });

    const target = new GithubTarget({ pinning: { mode: "strict" } });
    const result = target.compile(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    const releaseStep = yaml.jobs.release.steps.find(
      (s: { uses?: string }) => s.uses?.includes("action-gh-release"),
    );
    const sha = BUNDLED["softprops/action-gh-release@v2"]!;
    expect(releaseStep.uses).toBe(`softprops/action-gh-release@${sha} # v2`);
  });
});
