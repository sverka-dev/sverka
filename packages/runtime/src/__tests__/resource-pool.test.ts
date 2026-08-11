import { describe, it, expect } from "vitest";
import { ResourcePool } from "../internal/resource-pool.js";

describe("ResourcePool", () => {
  it("starts with the full capacity available", () => {
    const p = new ResourcePool(4, 1024);
    expect(p.cpu).toBe(4);
    expect(p.memory).toBe(1024);
  });

  it("acquires and decrements available resources", () => {
    const p = new ResourcePool(4, 1024);
    expect(p.tryAcquire(2, 512)).toBe(true);
    expect(p.cpu).toBe(2);
    expect(p.memory).toBe(512);
  });

  it("returns false when the request exceeds available cpu", () => {
    const p = new ResourcePool(4, 1024);
    expect(p.tryAcquire(8, 512)).toBe(false);
    // Nothing was reserved.
    expect(p.cpu).toBe(4);
    expect(p.memory).toBe(1024);
  });

  it("returns false when the request exceeds available memory", () => {
    const p = new ResourcePool(4, 1024);
    expect(p.tryAcquire(2, 2048)).toBe(false);
    expect(p.cpu).toBe(4);
    expect(p.memory).toBe(1024);
  });

  it("releases resources back to the pool", () => {
    const p = new ResourcePool(4, 1024);
    expect(p.tryAcquire(2, 512)).toBe(true);
    p.release(2, 512);
    expect(p.cpu).toBe(4);
    expect(p.memory).toBe(1024);
  });

  it("fromConfig parses string config values", () => {
    const p = ResourcePool.fromConfig("4", "2Gi");
    expect(p.cpu).toBe(4);
    expect(p.memory).toBe(2 * 1024 ** 3);
  });
});
