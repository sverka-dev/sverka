import { describe, it, expect } from "vitest";
import * as api from "../index.js";

describe("public API", () => {
  it("exports createDockerDriver", () => {
    expect(typeof api.createDockerDriver).toBe("function");
  });

  it("exports buildDockerArgs", () => {
    expect(typeof api.buildDockerArgs).toBe("function");
  });

  it("exports error classes", () => {
    expect(api.DockerExecutorError).toBeDefined();
    expect(api.ContainerPolicyError).toBeDefined();
    expect(api.ImageDigestError).toBeDefined();
  });
});
