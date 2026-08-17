import { describe, it, expect } from "vitest";
import { expr } from "../expr.js";
import { git, env } from "../context.js";
import { SdkError } from "../errors.js";
import type { Expression } from "@sverka/cdk";

describe("expr tagged template", () => {
  it("produces an Expression with kind, template, and refs", () => {
    const e = expr`${git.branch}`;
    expect(e.kind).toBe("expression");
    expect(e.template).toBe("${git.branch}");
    expect(e.refs).toHaveLength(1);
    expect(e.refs[0]).toEqual({ kind: "context", namespace: "git", field: "branch" });
  });

  it("includes literal text in template", () => {
    const e = expr`${git.branch} == "main"`;
    expect(e.template).toBe('${git.branch} == "main"');
    expect(e.refs).toHaveLength(1);
  });

  it("prefixes text before refs", () => {
    const e = expr`build-${git.sha}`;
    expect(e.template).toBe("build-${git.sha}");
    expect(e.refs).toHaveLength(1);
  });

  it("collects multiple refs", () => {
    const deployEnv = env.DEPLOY!;
    const e = expr`${git.branch} && ${deployEnv}`;
    expect(e.template).toBe("${git.branch} && ${env.DEPLOY}");
    expect(e.refs).toHaveLength(2);
    expect(e.refs[0]).toEqual({ kind: "context", namespace: "git", field: "branch" });
    expect(e.refs[1]).toEqual({ kind: "context", namespace: "env", field: "DEPLOY" });
  });

  it("inlines string values", () => {
    const target = "main";
    const e = expr`${git.branch} == "${target}"`;
    expect(e.template).toBe('${git.branch} == "main"');
    expect(e.refs).toHaveLength(1);
  });

  it("inlines number values", () => {
    const e = expr`${git.branch} == ${42}`;
    expect(e.template).toBe("${git.branch} == 42");
    expect(e.refs).toHaveLength(1);
  });

  it("inlines boolean values", () => {
    const e = expr`${git.branch} == ${true}`;
    expect(e.template).toBe("${git.branch} == true");
    expect(e.refs).toHaveLength(1);
  });

  it("collects step refs", () => {
    const ref = { kind: "step" as const, step: "build", output: "ok", type: "boolean" as const };
    const e = expr`${ref}`;
    expect(e.template).toBe("${build.ok}");
    expect(e.refs).toHaveLength(1);
    expect(e.refs[0]).toEqual(ref);
  });

  it("throws SdkError for non-primitive non-Reference values", () => {
    expect(() => expr`${{ foo: "bar" } as unknown as string}`).toThrow(SdkError);
    expect(() => expr`${{ foo: "bar" } as unknown as string}`).toThrow(/invalid interpolation/);
  });

  it("returns a frozen-looking Expression (readonly fields)", () => {
    const e: Expression = expr`${git.branch}`;
    expect(e.kind).toBe("expression");
    expect(typeof e.template).toBe("string");
    expect(Array.isArray(e.refs)).toBe(true);
  });
});
