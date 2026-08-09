import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the I/O surfaces so any accidental call is recorded. These mocks
// replace the module namespaces entirely; the composables should never
// reach them, so the mock functions should remain uncalled.
const childProcessMock = vi.hoisted(() => ({ spawn: vi.fn() }));
const fsMock = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: childProcessMock.spawn }));
vi.mock("node:fs", () => ({
  writeFileSync: fsMock.writeFileSync,
  readFileSync: fsMock.readFileSync,
}));

import { run } from "../composables/run.js";
import { pipeline } from "../composables/pipeline.js";
import { parallel } from "../composables/parallel.js";
import { when } from "../composables/when.js";
import { matrix } from "../composables/matrix.js";
import { workflow } from "../composables/workflow.js";
import { makePlanRuntime } from "./helpers/runtime.js";

// Composables and plan() must never touch the filesystem, spawn processes,
// or make network calls.
describe("laziness: composables perform no I/O", () => {
  beforeEach(() => {
    childProcessMock.spawn.mockClear();
    fsMock.writeFileSync.mockClear();
    fsMock.readFileSync.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defining composables touches no fs/process/network", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    pipeline(a, b);
    parallel(a, b);
    when("true", a);
    matrix({ node: ["20", "24"] }, a);
    workflow("ci", a, b);
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(fsMock.readFileSync).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("plan() in Plan mode performs no fs/process/network I/O", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const wf = workflow("ci", parallel(a, b), pipeline(a, b));
    await wf.plan(makePlanRuntime());
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(fsMock.readFileSync).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
