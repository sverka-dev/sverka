import { describe, it, expect } from "vitest";
import {
  normalizeSarif,
  computeFingerprint,
  createBaseline,
  updateBaseline,
  compareBaseline,
  loadBaseline,
  saveBaseline,
  isSuppressed,
  filterSuppressed,
  filterOnlyNew,
  NormalizationError,
  BaselineError,
  type Finding,
  type Severity,
  type FindingSource,
  type NormalizeContext,
  type FingerprintInput,
  type Baseline,
  type Suppression,
  type BaselineDiff,
  type SarifLog,
  type SarifRun,
  type SarifRule,
  type SarifResult,
  type SarifLocation,
  type NormalizationErrorCode,
  type BaselineErrorCode,
} from "../index.js";

describe("public API — functions", () => {
  it("exports normalizeSarif function", () => {
    expect(typeof normalizeSarif).toBe("function");
  });

  it("exports computeFingerprint function", () => {
    expect(typeof computeFingerprint).toBe("function");
  });

  it("exports baseline functions", () => {
    expect(typeof createBaseline).toBe("function");
    expect(typeof updateBaseline).toBe("function");
    expect(typeof compareBaseline).toBe("function");
    expect(typeof loadBaseline).toBe("function");
    expect(typeof saveBaseline).toBe("function");
  });

  it("exports suppress functions", () => {
    expect(typeof isSuppressed).toBe("function");
    expect(typeof filterSuppressed).toBe("function");
    expect(typeof filterOnlyNew).toBe("function");
  });
});

describe("public API — error classes", () => {
  it("exports NormalizationError class", () => {
    const err = new NormalizationError("msg", "INVALID_SARIF");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("NormalizationError");
    expect(err.code).toBe("INVALID_SARIF");
  });

  it("exports BaselineError class", () => {
    const err = new BaselineError("msg", "BASELINE_NOT_FOUND");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("BaselineError");
    expect(err.code).toBe("BASELINE_NOT_FOUND");
  });
});

describe("public API — types (compile-time check)", () => {
  it("all spec types are importable", () => {
    const _finding: Finding = {} as Finding;
    const _severity: Severity = "info";
    const _source: FindingSource = {} as FindingSource;
    const _ctx: NormalizeContext = {
      root: "/",
      checkIdPrefix: "",
      defaultConfidence: 0.5,
    };
    const _fpInput: FingerprintInput = {
      rule: "r",
      file: "f",
      startLine: 1,
      endLine: 1,
      checkId: "c",
    };
    const _baseline: Baseline = {} as Baseline;
    const _suppression: Suppression = {} as Suppression;
    const _diff: BaselineDiff = {} as BaselineDiff;
    const _sarifLog: SarifLog = {} as SarifLog;
    const _sarifRun: SarifRun = {} as SarifRun;
    const _sarifRule: SarifRule = {} as SarifRule;
    const _sarifResult: SarifResult = {} as SarifResult;
    const _sarifLocation: SarifLocation = {} as SarifLocation;
    const _normCode: NormalizationErrorCode = "INVALID_SARIF";
    const _baseCode: BaselineErrorCode = "BASELINE_NOT_FOUND";
    // Touch all to avoid unused warnings.
    expect(_finding).toBeDefined();
    expect(_severity).toBe("info");
    expect(_source).toBeDefined();
    expect(_ctx.root).toBe("/");
    expect(_fpInput.rule).toBe("r");
    expect(_baseline).toBeDefined();
    expect(_suppression).toBeDefined();
    expect(_diff).toBeDefined();
    expect(_sarifLog).toBeDefined();
    expect(_sarifRun).toBeDefined();
    expect(_sarifRule).toBeDefined();
    expect(_sarifResult).toBeDefined();
    expect(_sarifLocation).toBeDefined();
    expect(_normCode).toBe("INVALID_SARIF");
    expect(_baseCode).toBe("BASELINE_NOT_FOUND");
  });
});
