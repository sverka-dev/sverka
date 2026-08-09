import { describe, it, expect } from "vitest";
import {
  DockerExecutorError,
  ImageDigestError,
  ContainerPolicyError,
} from "../errors.js";

describe("DockerExecutorError", () => {
  it("sets name, code, and context", () => {
    const err = new DockerExecutorError("boom", "BOOM", { key: "value" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DockerExecutorError");
    expect(err.code).toBe("BOOM");
    expect(err.message).toBe("boom");
    expect(err.context).toEqual({ key: "value" });
  });

  it("context is optional", () => {
    const err = new DockerExecutorError("boom", "BOOM");
    expect(err.context).toBeUndefined();
  });
});

describe("ImageDigestError", () => {
  it("extends DockerExecutorError with code IMAGE_DIGEST_MISMATCH", () => {
    const err = new ImageDigestError("digest mismatch", {
      expected: "sha256:aaa",
      actual: "sha256:bbb",
    });
    expect(err).toBeInstanceOf(DockerExecutorError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ImageDigestError");
    expect(err.code).toBe("IMAGE_DIGEST_MISMATCH");
    expect(err.context).toEqual({ expected: "sha256:aaa", actual: "sha256:bbb" });
  });

  it("context is optional", () => {
    const err = new ImageDigestError("digest mismatch");
    expect(err.context).toBeUndefined();
  });
});

describe("ContainerPolicyError", () => {
  it("extends DockerExecutorError with code CONTAINER_POLICY_VIOLATION", () => {
    const err = new ContainerPolicyError("policy violated", { rule: "no-net" });
    expect(err).toBeInstanceOf(DockerExecutorError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ContainerPolicyError");
    expect(err.code).toBe("CONTAINER_POLICY_VIOLATION");
    expect(err.context).toEqual({ rule: "no-net" });
  });

  it("context is optional", () => {
    const err = new ContainerPolicyError("policy violated");
    expect(err.context).toBeUndefined();
  });
});
