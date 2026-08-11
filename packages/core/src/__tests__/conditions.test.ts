import { describe, it, expect } from "vitest";
import { evaluateCondition } from "../internal/conditions.js";
import { CompositionError } from "../errors.js";
import type { PlanContext } from "../runtime.js";

describe("evaluateCondition", () => {
  it("returns true when context is undefined (include by default)", () => {
    expect(evaluateCondition("schedule == 'nightly'", undefined)).toBe(true);
    expect(evaluateCondition("anything", undefined)).toBe(true);
  });

  it("string equality against context", () => {
    const ctx: PlanContext = { schedule: "nightly" };
    expect(evaluateCondition("schedule == 'nightly'", ctx)).toBe(true);
    expect(evaluateCondition("schedule == 'ci'", ctx)).toBe(false);
  });

  it("bare identifier is truthy when value is truthy", () => {
    expect(evaluateCondition("flag", { flag: true })).toBe(true);
    expect(evaluateCondition("flag", { flag: false })).toBe(false);
    expect(evaluateCondition("flag", { flag: "yes" })).toBe(true);
    expect(evaluateCondition("flag", { flag: "" })).toBe(false);
    expect(evaluateCondition("flag", { flag: 1 })).toBe(true);
    expect(evaluateCondition("flag", { flag: 0 })).toBe(false);
  });

  it("unknown identifier resolves to falsy", () => {
    expect(evaluateCondition("missing", {})).toBe(false);
  });

  it("ignores inherited object prototype properties", () => {
    expect(evaluateCondition("constructor", {})).toBe(false);
    expect(evaluateCondition("toString", {})).toBe(false);
    expect(evaluateCondition("hasOwnProperty", {})).toBe(false);
  });

  it("boolean literals", () => {
    expect(evaluateCondition("true", {})).toBe(true);
    expect(evaluateCondition("false", {})).toBe(false);
  });

  it("number literals and numeric equality", () => {
    expect(evaluateCondition("1 == 1", {})).toBe(true);
    expect(evaluateCondition("1 == 2", {})).toBe(false);
  });

  it("loose equality coerces string/number", () => {
    expect(evaluateCondition("v == 1", { v: "1" })).toBe(true);
    expect(evaluateCondition("v == '1'", { v: 1 })).toBe(true);
  });

  it("!= is the negation of ==", () => {
    expect(evaluateCondition("schedule != 'ci'", { schedule: "nightly" })).toBe(true);
    expect(evaluateCondition("schedule != 'nightly'", { schedule: "nightly" })).toBe(false);
  });

  it("NOT > AND > OR precedence", () => {
    // a && b || !c  with a=true,b=false,c=false => (true && false) || (!false) => false || true => true
    expect(evaluateCondition("a && b || !c", { a: true, b: false, c: false })).toBe(true);
    // a && b || !c  with a=true,b=false,c=true  => (true && false) || (!true)  => false || false => false
    expect(evaluateCondition("a && b || !c", { a: true, b: false, c: true })).toBe(false);
  });

  it("NOT binds tighter than AND", () => {
    // !a && b : a=false,b=true => (!false) && true => true
    expect(evaluateCondition("!a && b", { a: false, b: true })).toBe(true);
    // !a && b : a=true,b=true  => (!true) && true => false
    expect(evaluateCondition("!a && b", { a: true, b: true })).toBe(false);
  });

  it("parentheses override precedence", () => {
    const ctx: PlanContext = { a: true, b: false, c: true };
    expect(evaluateCondition("a && (b || c)", ctx)).toBe(true);
    expect(evaluateCondition("(a && b) || c", ctx)).toBe(true);
    expect(evaluateCondition("!(a && c)", ctx)).toBe(false);
  });

  it("dotted identifiers are looked up by full key", () => {
    const ctx: PlanContext = { "git.branch": "main" };
    expect(evaluateCondition("git.branch == 'main'", ctx)).toBe(true);
  });

  it("array context values: non-empty is truthy", () => {
    expect(evaluateCondition("files", { files: ["a", "b"] })).toBe(true);
    expect(evaluateCondition("files", { files: [] })).toBe(false);
  });

  it("whitespace is tolerated", () => {
    expect(evaluateCondition("  schedule   ==   'nightly'  ", { schedule: "nightly" })).toBe(true);
  });

  it("throws CompositionError on malformed expression", () => {
    expect(() => evaluateCondition("!!!", {})).toThrow(CompositionError);
    expect(() => evaluateCondition("a ==", {})).toThrow(CompositionError);
    expect(() => evaluateCondition("a &&", {})).toThrow(CompositionError);
    expect(() => evaluateCondition("(a", {})).toThrow(CompositionError);
    expect(() => evaluateCondition("'unclosed", {})).toThrow(CompositionError);
  });

  it("malformed error has code COMPOSITION_ERROR", () => {
    let caught: unknown;
    try {
      evaluateCondition("!!!", {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CompositionError);
    if (!(caught instanceof CompositionError)) return;
    expect(caught.code).toBe("COMPOSITION_ERROR");
    expect(caught.context).toMatchObject({ reason: expect.any(String) });
  });
});
