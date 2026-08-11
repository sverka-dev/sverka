import { describe, it, expect } from "vitest";
import {
  createPlanner,
  DiscoveryError,
  type Planner,
  type DiscoverOptions,
  type ProjectContext,
  type PlanProposal,
  type ProposedCheck,
  type LocalSignal,
  type LocalSignalType,
  type DetectedLanguage,
  type DetectedPackageManager,
  type MonorepoMarker,
  type ChangedFile,
  type DiscoveryExplanation,
  type DiscoveryErrorCode,
} from "../index.js";

describe("public API", () => {
  it("exports createPlanner function", () => {
    expect(typeof createPlanner).toBe("function");
    const planner = createPlanner();
    expect(typeof planner.discover).toBe("function");
    expect(typeof planner.plan).toBe("function");
  });

  it("exports DiscoveryError class", () => {
    const err = new DiscoveryError("msg", "ROOT_NOT_FOUND");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DiscoveryError");
    expect(err.code).toBe("ROOT_NOT_FOUND");
  });

  it("exports all spec types (compile-time check)", () => {
    const _planner: Planner = createPlanner();
    const _opts: DiscoverOptions = { root: "/tmp" };
    const _ctx: ProjectContext = {} as ProjectContext;
    const _proposal: PlanProposal = {} as PlanProposal;
    const _check: ProposedCheck = {} as ProposedCheck;
    const _signal: LocalSignal = {} as LocalSignal;
    const _sigType: LocalSignalType = "manifest";
    const _lang: DetectedLanguage = {} as DetectedLanguage;
    const _pm: DetectedPackageManager = {} as DetectedPackageManager;
    const _mono: MonorepoMarker = {} as MonorepoMarker;
    const _changed: ChangedFile = {} as ChangedFile;
    const _expl: DiscoveryExplanation = {} as DiscoveryExplanation;
    const _code: DiscoveryErrorCode = "ROOT_NOT_FOUND";
    // Touch all to avoid unused warnings; verify the types carry real values.
    expect(_opts.root).toBe("/tmp");
    expect(typeof _sigType).toBe("string");
    expect(typeof _code).toBe("string");
    expect(_ctx).toBeDefined();
    expect(_proposal).toBeDefined();
    expect(_check).toBeDefined();
    expect(_signal).toBeDefined();
    expect(_lang).toBeDefined();
    expect(_pm).toBeDefined();
    expect(_mono).toBeDefined();
    expect(_changed).toBeDefined();
    expect(_expl).toBeDefined();
    expect(_planner).toBeDefined();
  });
});
