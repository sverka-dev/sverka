import { describe, it, expect } from "vitest";
import { task, run } from "../index.js";

describe("task helper", () => {
  it("returns an Operation with the given name", () => {
    const op = task("lint", run({ command: "bun", args: ["run", "lint"] }));
    expect(op).toBeDefined();
    expect(op.spec.name).toBe("lint");
    expect(op.kind).toBe("run");
  });

  it("is equivalent to op.named(name)", () => {
    const base = run({ command: "echo", args: ["hi"] });
    const viaTask = task("greet", base);
    const viaNamed = base.named("greet");
    expect(viaTask.spec.name).toBe(viaNamed.spec.name);
    expect(viaTask.kind).toBe(viaNamed.kind);
  });

  it("preserves the command and args from the original operation", () => {
    const op = task("test", run({ command: "bun", args: ["test"] }));
    expect(op.spec.command).toBe("bun");
    expect(op.spec.args).toEqual(["test"]);
  });
});
