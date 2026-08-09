import { describe, it, expect } from "vitest";
import { run } from "../../composables/run.js";
import { asNode } from "../../internal/node.js";

describe("run()", () => {
  it("creates a node with kind 'run' by default", () => {
    const op = run({ command: "eslint", args: ["."] });
    expect(op.kind).toBe("run");
    expect(op.spec.command).toBe("eslint");
    expect(op.spec.args).toEqual(["."]);
  });

  it("honors an explicit kind in spec", () => {
    const op = run({ kind: "check", command: "tsc" });
    expect(op.kind).toBe("check");
  });

  it("is lazy: no side effects at call time", () => {
    const op = run({ command: "echo", image: "node:24" });
    expect(op).toBeDefined();
    expect(asNode(op).predecessors).toEqual([]);
  });

  it("preserves all spec fields", () => {
    const op = run({
      command: "test",
      env: { NODE_ENV: "test" },
      timeoutSeconds: 30,
      retries: 2,
      continueOnError: true,
      network: "deny",
    });
    expect(op.spec.env).toEqual({ NODE_ENV: "test" });
    expect(op.spec.timeoutSeconds).toBe(30);
    expect(op.spec.retries).toBe(2);
    expect(op.spec.continueOnError).toBe(true);
    expect(op.spec.network).toBe("deny");
  });
});
