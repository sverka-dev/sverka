import { describe, it, expect } from "vitest";
import { image, images } from "../images.js";
import { SdkError } from "../errors.js";

describe("images", () => {
  it("images.node[22] → { ref: 'node:22' }", () => {
    expect(images.node[22]).toEqual({ ref: "node:22" });
  });

  it("images.node.latest → { ref: 'node:latest' }", () => {
    expect(images.node.latest).toEqual({ ref: "node:latest" });
  });

  it("images.ubuntu.latest → { ref: 'ubuntu:latest' }", () => {
    expect(images.ubuntu.latest).toEqual({ ref: "ubuntu:latest" });
  });

  it("images.ubuntu[24.04] → { ref: 'ubuntu:24.04' }", () => {
    expect(images.ubuntu["24.04"]).toEqual({ ref: "ubuntu:24.04" });
  });
});

describe("image()", () => {
  it("creates an ImageRef from a raw OCI reference", () => {
    expect(image("ghcr.io/acme/build:2026-08")).toEqual({ ref: "ghcr.io/acme/build:2026-08" });
  });

  it("throws SdkError for empty string", () => {
    expect(() => image("")).toThrow(SdkError);
  });
});
