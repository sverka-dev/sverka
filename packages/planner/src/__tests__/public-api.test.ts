import { describe, it, expect } from "vitest";
import {
  createPlanner,
  bindRunPlan,
  computeReachableSteps,
  DiscoveryError,
  PlannerError,
  type Planner,
  type BindRunPlanOptions,
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
  type PlannerErrorCode,
} from "../index.js";

describe("public API", () => {
  it("exports createPlanner function", () => {
    expect(typeof createPlanner).toBe("function");
    const planner = createPlanner();
    expect(typeof planner.discover).toBe("function");
    expect(typeof planner.plan).toBe("function");
    expect(typeof planner.bindRunPlan).toBe("function");
  });

  it("exports bindRunPlan and computeReachableSteps", () => {
    expect(typeof bindRunPlan).toBe("function");
    expect(typeof computeReachableSteps).toBe("function");
  });

  it("exports DiscoveryError and PlannerError classes", () => {
    const dErr = new DiscoveryError("msg", "ROOT_NOT_FOUND");
    expect(dErr).toBeInstanceOf(Error);
    expect(dErr.code).toBe("ROOT_NOT_FOUND");

    const pErr = new PlannerError("msg", "ENTRY_NOT_FOUND");
    expect(pErr).toBeInstanceOf(Error);
    expect(pErr.code).toBe("ENTRY_NOT_FOUND");
  });

  it("exports all spec types (compile-time check)", () => {
    const _planner: Planner = createPlanner();
    const _opts: DiscoverOptions = { root: "/tmp" };
    const _bindOpts: BindRunPlanOptions = {} as BindRunPlanOptions;
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
    const _dCode: DiscoveryErrorCode = "ROOT_NOT_FOUND";
    const _pCode: PlannerErrorCode = "ENTRY_NOT_FOUND";
    // Touch all to avoid unused warnings; verify the exported values are usable.
    const exported = [_ctx, _proposal, _check, _signal, _lang, _pm, _mono, _changed, _expl, _planner, _bindOpts];
    expect(exported).toHaveLength(11);
    expect(_opts.root).toBe("/tmp");
    expect([_sigType, _dCode, _pCode]).toEqual(["manifest", "ROOT_NOT_FOUND", "ENTRY_NOT_FOUND"]);
  });
});
