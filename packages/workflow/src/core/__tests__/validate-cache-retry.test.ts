import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep } from "../../cdk/index.js";
import { synthesize, SynthesisError } from "../index.js";

describe("validate — cache keys", () => {
  it("rejects step-output references in cache key", () => {
    const proj = new Project("p");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "make build",
      cache: {
        paths: ["dist"],
        key: "build-${{ steps.build.outputs.version }}",
      },
    });
    expect(() => synthesize(proj)).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("CACHE_KEY_STEP_REF");
    }
  });

  it("rejects step-output references in restoreKeys", () => {
    const proj = new Project("p");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "make build",
      cache: {
        paths: ["dist"],
        key: "build-linux",
        restoreKeys: ["build-${{ steps.prev.outputs.hash }}"],
      },
    });
    expect(() => synthesize(proj)).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("CACHE_KEY_STEP_REF");
    }
  });

  it("accepts context refs (env/git/matrix/inputs) in cache key", () => {
    const proj = new Project("p");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "make build",
      cache: {
        paths: ["dist"],
        key: "build-${{ env.NODE_VERSION }}-${{ git.sha }}",
        restoreKeys: ["build-${{ matrix.os }}"],
      },
    });
    expect(() => synthesize(proj)).not.toThrow();
  });

  it("accepts cache keys with no refs", () => {
    const proj = new Project("p");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "make build",
      cache: { paths: ["dist"], key: "build-static-key" },
    });
    expect(() => synthesize(proj)).not.toThrow();
  });
});

describe("validate — retry policies", () => {
  it("rejects negative max", () => {
    const proj = new Project("p");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "make build",
      retry: { max: -1 },
    });
    expect(() => synthesize(proj)).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("INVALID_RETRY_POLICY");
    }
  });

  it("rejects negative backoff.baseMs", () => {
    const proj = new Project("p");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "make build",
      retry: { max: 2, backoff: { baseMs: -100 } },
    });
    expect(() => synthesize(proj)).toThrow(SynthesisError);
    try {
      synthesize(proj);
    } catch (err) {
      expect((err as SynthesisError).code).toBe("INVALID_RETRY_POLICY");
    }
  });

  it("accepts a valid retry with backoff", () => {
    const proj = new Project("p");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "make build",
      retry: { max: 3, backoff: { baseMs: 1000, maxMs: 30000, factor: 2 } },
    });
    expect(() => synthesize(proj)).not.toThrow();
  });

  it("accepts retry with max=0 (no retries)", () => {
    const proj = new Project("p");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "make build",
      retry: { max: 0 },
    });
    expect(() => synthesize(proj)).not.toThrow();
  });
});
