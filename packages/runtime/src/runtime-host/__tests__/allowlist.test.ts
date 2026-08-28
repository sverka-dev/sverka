import { describe, it, expect } from "vitest";
import { createAllowlist } from "../allowlist.js";

describe("createAllowlist", () => {
  it("matches a bare name entry by basename", () => {
    const al = createAllowlist(["node"]);
    expect(al.isAllowed("node")).toBe(true);
  });

  it("does not match a bare name to a different command", () => {
    const al = createAllowlist(["node"]);
    expect(al.isAllowed("git")).toBe(false);
  });

  it("matches an absolute path entry exactly", () => {
    const al = createAllowlist(["/usr/bin/git"]);
    expect(al.isAllowed("/usr/bin/git")).toBe(true);
  });

  it("does not match an absolute path to a bare name", () => {
    const al = createAllowlist(["/usr/bin/git"]);
    expect(al.isAllowed("git")).toBe(false);
  });

  it("matches a bare entry against the basename of an absolute-path command", () => {
    const al = createAllowlist(["node"]);
    expect(al.isAllowed("/usr/local/bin/node")).toBe(true);
  });

  it("empty allowlist allows nothing", () => {
    const al = createAllowlist([]);
    expect(al.isAllowed("node")).toBe(false);
    expect(al.isAllowed("/usr/bin/node")).toBe(false);
  });

  it("empty command is not allowed", () => {
    const al = createAllowlist(["node"]);
    expect(al.isAllowed("")).toBe(false);
  });

  it("exposes the entries", () => {
    const al = createAllowlist(["node", "/usr/bin/git"]);
    expect(al.entries).toEqual(["node", "/usr/bin/git"]);
  });
});
