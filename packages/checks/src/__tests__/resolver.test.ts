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
    expect(r!.operation.command).toBe("bun");
    expect(r!.operation.args).toEqual(["run", "typecheck"]);
    expect(r!.operation.kind).toBe("check");
    expect(r!.operation.id).toBe("prop-typecheck");
    expect(r!.operation.name).toBe("typecheck");
    expect(r!.operation.description).toBe("test");
  });

  it("resolves lint to bun run lint", () => {
    const r = resolver.resolve(makeCheck("lint"), ctx);
    expect(r).not.toBeNull();
    expect(r!.operation.command).toBe("bun");
    expect(r!.operation.args).toEqual(["run", "lint"]);
  });

  it("resolves test to bun run test", () => {
    const r = resolver.resolve(makeCheck("test"), ctx);
    expect(r).not.toBeNull();
    expect(r!.operation.command).toBe("bun");
    expect(r!.operation.args).toEqual(["run", "test"]);
  });
});

describe("createBuiltinResolver — Node (npm/yarn/pnpm)", () => {
  it("resolves typecheck with npm", () => {
    const r = resolver.resolve(makeCheck("typecheck"), makeContext(["npm"]));
    expect(r).not.toBeNull();
    expect(r!.operation.command).toBe("npm");
    expect(r!.operation.args).toEqual(["run", "typecheck"]);
  });

  it("resolves lint with yarn", () => {
    const r = resolver.resolve(makeCheck("lint"), makeContext(["yarn"]));
    expect(r).not.toBeNull();
    expect(r!.operation.command).toBe("yarn");
    expect(r!.operation.args).toEqual(["run", "lint"]);
  });

  it("resolves test with pnpm", () => {
    const r = resolver.resolve(makeCheck("test"), makeContext(["pnpm"]));
    expect(r).not.toBeNull();
    expect(r!.operation.command).toBe("pnpm");
    expect(r!.operation.args).toEqual(["run", "test"]);
  });
});

describe("createBuiltinResolver — Python", () => {
  it("resolves lint to ruff check", () => {
    const r = resolver.resolve(makeCheck("lint"), makeContext(["poetry"]));
    expect(r).not.toBeNull();
    expect(r!.operation.command).toBe("ruff");
    expect(r!.operation.args).toEqual(["check"]);
  });

  it("resolves test to pytest", () => {
    const r = resolver.resolve(makeCheck("test"), makeContext(["pip"]));
    expect(r).not.toBeNull();
    expect(r!.operation.command).toBe("pytest");
    expect(r!.operation.args).toEqual([]);
  });
});

describe("createBuiltinResolver — Rust", () => {
  const ctx = makeContext(["cargo"]);

  it("resolves clippy to cargo clippy", () => {
    const r = resolver.resolve(makeCheck("clippy"), ctx);
    expect(r).not.toBeNull();
    expect(r!.operation.command).toBe("cargo");
    expect(r!.operation.args).toEqual(["clippy"]);
  });

  it("resolves fmt-check to cargo fmt --check", () => {
    const r = resolver.resolve(makeCheck("fmt-check"), ctx);
    expect(r).not.toBeNull();
    expect(r!.operation.command).toBe("cargo");
    expect(r!.operation.args).toEqual(["fmt", "--check"]);
  });

  it("resolves test to cargo test", () => {
    const r = resolver.resolve(makeCheck("test"), ctx);
    expect(r).not.toBeNull();
    expect(r!.operation.command).toBe("cargo");
    expect(r!.operation.args).toEqual(["test"]);
  });
});

describe("createBuiltinResolver — Go", () => {
  const ctx = makeContext(["go"]);

  it("resolves vet to go vet ./...", () => {
    const r = resolver.resolve(makeCheck("vet"), ctx);
    expect(r).not.toBeNull();
    expect(r!.operation.command).toBe("go");
    expect(r!.operation.args).toEqual(["vet", "./..."]);
  });

  it("resolves test to go test ./...", () => {
    const r = resolver.resolve(makeCheck("test"), ctx);
    expect(r).not.toBeNull();
    expect(r!.operation.command).toBe("go");
    expect(r!.operation.args).toEqual(["test", "./..."]);
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
    const r = resolver.resolve(
      makeCheck("test"),
      makeContext(["cargo", "bun"]),
    );
    expect(r).not.toBeNull();
    // Node entries come before cargo in table order, so bun wins.
    expect(r!.operation.command).toBe("bun");
    expect(r!.operation.args).toEqual(["run", "test"]);
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
          operation: {
            id: "op-1",
            kind: "check",
            name: "custom",
            command: "my-tool",
            args: ["--sarif", "out.sarif"],
          },
          outputs: [{ path: "out.sarif", format: "sarif" }],
        };
      },
    };
    const r = custom.resolve(makeCheck("custom"), makeContext([]));
    expect(r).not.toBeNull();
    expect(r!.operation.command).toBe("my-tool");
    expect(r!.outputs).toHaveLength(1);
    expect(r!.outputs[0]!.format).toBe("sarif");
  });
});
