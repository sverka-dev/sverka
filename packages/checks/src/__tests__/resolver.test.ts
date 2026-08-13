import { describe, it, expect } from "vitest";
import { createBuiltinResolver } from "../resolver.js";
import type { CheckResolver, ResolvedCheck } from "../resolver.js";
import { makeCheck, makeContext } from "./helpers/fixtures.js";

const resolver = createBuiltinResolver();

describe("createBuiltinResolver — Node (bun)", () => {
  const ctx = makeContext(["bun"]);

  it("resolves typecheck to bun run typecheck", () => {
    const r = resolver.resolve(makeCheck("typecheck"), ctx);
    expect(r).not.toBeNull();
    expect(r!.step.id).toBe("checks/typecheck");
    expect(r!.step.operations).toHaveLength(1);
    expect(r!.step.operations[0]!.kind).toBe("shell");
    expect((r!.step.operations[0] as { command: string }).command).toBe("bun run typecheck");
    expect(r!.step.runtime.mode).toBe("host");
    expect(r!.step.runtime.workingDir).toBe(ctx.root);
  });

  it("resolves lint to bun run lint", () => {
    const r = resolver.resolve(makeCheck("lint"), ctx);
    expect(r).not.toBeNull();
    expect((r!.step.operations[0] as { command: string }).command).toBe("bun run lint");
  });

  it("resolves test to bun run test", () => {
    const r = resolver.resolve(makeCheck("test"), ctx);
    expect(r).not.toBeNull();
    expect((r!.step.operations[0] as { command: string }).command).toBe("bun run test");
  });
});

describe("createBuiltinResolver — Node (npm/yarn/pnpm)", () => {
  it("resolves typecheck with npm", () => {
    const r = resolver.resolve(makeCheck("typecheck"), makeContext(["npm"]));
    expect(r).not.toBeNull();
    expect((r!.step.operations[0] as { command: string }).command).toBe("npm run typecheck");
  });

  it("resolves lint with yarn", () => {
    const r = resolver.resolve(makeCheck("lint"), makeContext(["yarn"]));
    expect(r).not.toBeNull();
    expect((r!.step.operations[0] as { command: string }).command).toBe("yarn run lint");
  });

  it("resolves test with pnpm", () => {
    const r = resolver.resolve(makeCheck("test"), makeContext(["pnpm"]));
    expect(r).not.toBeNull();
    expect((r!.step.operations[0] as { command: string }).command).toBe("pnpm run test");
  });
});

describe("createBuiltinResolver — Python", () => {
  it("resolves lint to ruff check", () => {
    const r = resolver.resolve(makeCheck("lint"), makeContext(["poetry"]));
    expect(r).not.toBeNull();
    expect((r!.step.operations[0] as { command: string }).command).toBe("ruff check");
  });

  it("resolves test to pytest", () => {
    const r = resolver.resolve(makeCheck("test"), makeContext(["pip"]));
    expect(r).not.toBeNull();
    expect((r!.step.operations[0] as { command: string }).command).toBe("pytest");
  });
});

describe("createBuiltinResolver — Rust", () => {
  const ctx = makeContext(["cargo"]);

  it("resolves clippy to cargo clippy", () => {
    const r = resolver.resolve(makeCheck("clippy"), ctx);
    expect(r).not.toBeNull();
    expect((r!.step.operations[0] as { command: string }).command).toBe("cargo clippy");
  });

  it("resolves fmt-check to cargo fmt --check", () => {
    const r = resolver.resolve(makeCheck("fmt-check"), ctx);
    expect(r).not.toBeNull();
    expect((r!.step.operations[0] as { command: string }).command).toBe("cargo fmt --check");
  });

  it("resolves test to cargo test", () => {
    const r = resolver.resolve(makeCheck("test"), ctx);
    expect(r).not.toBeNull();
    expect((r!.step.operations[0] as { command: string }).command).toBe("cargo test");
  });
});

describe("createBuiltinResolver — Go", () => {
  const ctx = makeContext(["go"]);

  it("resolves vet to go vet ./...", () => {
    const r = resolver.resolve(makeCheck("vet"), ctx);
    expect(r).not.toBeNull();
    expect((r!.step.operations[0] as { command: string }).command).toBe("go vet ./...");
  });

  it("resolves test to go test ./...", () => {
    const r = resolver.resolve(makeCheck("test"), ctx);
    expect(r).not.toBeNull();
    expect((r!.step.operations[0] as { command: string }).command).toBe("go test ./...");
  });
});

describe("createBuiltinResolver — unknown / unmatched", () => {
  it("returns null for unknown checkId", () => {
    const r = resolver.resolve(makeCheck("foo"), makeContext(["bun"]));
    expect(r).toBeNull();
  });

  it("returns null for known checkId with unmatched packageManager", () => {
    const r = resolver.resolve(makeCheck("clippy"), makeContext(["bun"]));
    expect(r).toBeNull();
  });
});

describe("createBuiltinResolver — multiple package managers", () => {
  it("first matching entry in table order wins (bun before cargo)", () => {
    const r = resolver.resolve(makeCheck("test"), makeContext(["cargo", "bun"]));
    expect(r).not.toBeNull();
    // Node entries come before cargo in table order, so bun wins.
    expect((r!.step.operations[0] as { command: string }).command).toBe("bun run test");
  });

  it("honours proposal reason over table order in polyglot projects", () => {
    const rustCheck = makeCheck("test", "Rust project defaults");
    const r = resolver.resolve(rustCheck, makeContext(["cargo", "bun"]));
    expect(r).not.toBeNull();
    expect((r!.step.operations[0] as { command: string }).command).toBe("cargo test");
  });
});

describe("createBuiltinResolver — outputs", () => {
  it("all built-in checks have empty outputs", () => {
    const ctx = makeContext(["bun"]);
    for (const checkId of ["typecheck", "lint", "test"]) {
      const r = resolver.resolve(makeCheck(checkId), ctx);
      expect(r).not.toBeNull();
      expect(r!.outputs).toEqual([]);
    }
  });
});

describe("createBuiltinResolver — determinism", () => {
  it("same check + ctx produces byte-identical ResolvedCheck", () => {
    const ctx = makeContext(["bun"]);
    const check = makeCheck("lint", "reason");
    const r1 = resolver.resolve(check, ctx) as ResolvedCheck;
    const r2 = resolver.resolve(check, ctx) as ResolvedCheck;
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

describe("custom CheckResolver", () => {
  it("a user-implemented resolver returns a ResolvedCheck with a SARIF output", () => {
    const custom: CheckResolver = {
      resolve() {
        return {
          checkId: "custom",
          step: {
            id: "checks/custom",
            runtime: { mode: "host" },
            operations: [{ kind: "shell", command: "my-tool --sarif out.sarif" }],
            inputs: [],
            outputs: [],
            dependencies: [],
          },
          outputs: [{ path: "out.sarif", format: "sarif" }],
        };
      },
    };
    const r = custom.resolve(makeCheck("custom"), makeContext([]));
    expect(r).not.toBeNull();
    expect((r!.step.operations[0] as { command: string }).command).toBe("my-tool --sarif out.sarif");
    expect(r!.outputs).toHaveLength(1);
    expect(r!.outputs[0]!.format).toBe("sarif");
  });
});
