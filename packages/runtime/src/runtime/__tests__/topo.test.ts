import { describe, it, expect } from "vitest";
import { topoSort, dependentsOf } from "../internal/topo.js";
import type { PlanOperation } from "@sverka/workflow";
import { validOperation } from "./helpers/fixtures.js";

function op(id: string, dependsOn: readonly string[] = []): PlanOperation {
  return validOperation({ id, name: id, dependsOn });
}

describe("topoSort", () => {
  it("sorts a linear chain a -> b -> c", () => {
    const ops = [op("c", ["b"]), op("b", ["a"]), op("a")];
    const r = topoSort(ops);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.order).toEqual(["a", "b", "c"]);
  });

  it("sorts a diamond a -> {b, c} -> d preserving input order among siblings", () => {
    const ops = [op("a"), op("b", ["a"]), op("c", ["a"]), op("d", ["b", "c"])];
    const r = topoSort(ops);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.order[0]).toBe("a");
      expect(r.order[3]).toBe("d");
      // b and c come after a, before d, in input order.
      expect(r.order.indexOf("b")).toBeLessThan(r.order.indexOf("d"));
      expect(r.order.indexOf("c")).toBeLessThan(r.order.indexOf("d"));
    }
  });

  it("independent ops run in input order", () => {
    const ops = [op("x"), op("y"), op("z")];
    const r = topoSort(ops);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.order).toEqual(["x", "y", "z"]);
  });

  it("detects a cycle and returns the cycle path", () => {
    const ops = [op("a", ["c"]), op("b", ["a"]), op("c", ["b"])];
    const r = topoSort(ops);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cycle.length).toBeGreaterThan(0);
      // Every id in the cycle is one of a, b, c.
      for (const id of r.cycle) expect(["a", "b", "c"]).toContain(id);
    }
  });

  it("treats a self-loop as a cycle of length 1", () => {
    const ops = [op("a", ["a"])];
    const r = topoSort(ops);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cycle).toContain("a");
  });

  it("ignores deps that do not exist in the plan", () => {
    const ops = [op("a", ["ghost"])];
    const r = topoSort(ops);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.order).toEqual(["a"]);
  });
});

describe("dependentsOf", () => {
  it("returns direct dependents", () => {
    const ops = [op("a"), op("b", ["a"])];
    expect([...dependentsOf(ops, "a")]).toEqual(["b"]);
  });

  it("returns transitive dependents in a diamond", () => {
    const ops = [op("a"), op("b", ["a"]), op("c", ["a"]), op("d", ["b", "c"])];
    const deps = dependentsOf(ops, "a");
    expect(deps.has("b")).toBe(true);
    expect(deps.has("c")).toBe(true);
    expect(deps.has("d")).toBe(true);
  });

  it("returns an empty set when nothing depends on the id", () => {
    const ops = [op("a"), op("b", ["a"])];
    expect(dependentsOf(ops, "b").size).toBe(0);
  });
});
