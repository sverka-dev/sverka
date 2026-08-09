import { describe, it, expect } from "vitest";
import {
  DockerExecutor,
  verifyImageDigest,
  DockerCacheManager,
  DockerExecutorError,
  ImageDigestError,
  ContainerPolicyError,
} from "../index.js";
import type { DockerExecutorConfig, CacheManager } from "../index.js";

describe("public API", () => {
  it("exports DockerExecutor class", () => {
    expect(typeof DockerExecutor).toBe("function");
    const exec = new DockerExecutor({
      runAs: "1000:1000",
      cacheDir: "/tmp/sverka-cache",
    });
    expect(exec.name).toBe("docker");
    expect(typeof exec.canExecute).toBe("function");
    expect(typeof exec.execute).toBe("function");
    expect(typeof exec.dispose).toBe("function");
  });

  it("exports verifyImageDigest function", () => {
    expect(typeof verifyImageDigest).toBe("function");
  });

  it("exports DockerCacheManager class", () => {
    expect(typeof DockerCacheManager).toBe("function");
    const mgr = new DockerCacheManager("/tmp/sverka-cache");
    expect(typeof mgr.prepare).toBe("function");
    expect(typeof mgr.collect).toBe("function");
  });

  it("exports error classes", () => {
    expect(new DockerExecutorError("x", "X")).toBeInstanceOf(Error);
    expect(new ImageDigestError("x")).toBeInstanceOf(DockerExecutorError);
    expect(new ContainerPolicyError("x")).toBeInstanceOf(DockerExecutorError);
  });

  it("exports types (compile-time check)", () => {
    const config: DockerExecutorConfig = {
      runAs: "1000:1000",
      cacheDir: "/tmp/sverka-cache",
    };
    const mgr: CacheManager = new DockerCacheManager("/tmp/sverka-cache");
    expect(config.runAs).toBe("1000:1000");
    expect(typeof mgr.prepare).toBe("function");
  });
});
