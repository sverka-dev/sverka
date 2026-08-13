import { describe, it, expect } from "vitest";
import { createValueStore } from "../value-store.js";

describe("ValueStore", () => {
  it("set/get scalar outputs", () => {
    const store = createValueStore();
    store.set("ci/build", "version", "1.2.3");
    expect(store.get("ci/build", "version")).toBe("1.2.3");
  });

  it("returns undefined for unknown outputs", () => {
    const store = createValueStore();
    expect(store.get("ci/build", "version")).toBeUndefined();
  });

  it("handles different types", () => {
    const store = createValueStore();
    store.set("ci/step", "count", 42);
    store.set("ci/step", "flag", true);
    store.set("ci/step", "name", "test");
    expect(store.get("ci/step", "count")).toBe(42);
    expect(store.get("ci/step", "flag")).toBe(true);
    expect(store.get("ci/step", "name")).toBe("test");
  });

  it("isolates outputs by step", () => {
    const store = createValueStore();
    store.set("ci/build", "version", "1.0");
    store.set("ci/deploy", "version", "2.0");
    expect(store.get("ci/build", "version")).toBe("1.0");
    expect(store.get("ci/deploy", "version")).toBe("2.0");
  });
});
