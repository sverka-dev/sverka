import { describe, it, expect } from "vitest";
import { env, secrets, git, change, event, run, inputs } from "../context.js";

describe("context namespaces", () => {
  it("env.CI_TRACE → ContextRef(env, CI_TRACE)", () => {
    expect(env.CI_TRACE).toEqual({ kind: "context", namespace: "env", field: "CI_TRACE" });
  });

  it("secrets.NPM_TOKEN → ContextRef(secrets, NPM_TOKEN)", () => {
    expect(secrets.NPM_TOKEN).toEqual({ kind: "context", namespace: "secrets", field: "NPM_TOKEN" });
  });

  it("git.sha → ContextRef(git, sha)", () => {
    expect(git.sha).toEqual({ kind: "context", namespace: "git", field: "sha" });
  });

  it("git.branch → ContextRef(git, branch)", () => {
    expect(git.branch).toEqual({ kind: "context", namespace: "git", field: "branch" });
  });

  it("git.tag → ContextRef(git, tag)", () => {
    expect(git.tag).toEqual({ kind: "context", namespace: "git", field: "tag" });
  });

  it("change.id → ContextRef(change, id)", () => {
    expect(change.id).toEqual({ kind: "context", namespace: "change", field: "id" });
  });

  it("change.source → ContextRef(change, source)", () => {
    expect(change.source).toEqual({ kind: "context", namespace: "change", field: "source" });
  });

  it("change.target → ContextRef(change, target)", () => {
    expect(change.target).toEqual({ kind: "context", namespace: "change", field: "target" });
  });

  it("change.draft → ContextRef(change, draft)", () => {
    expect(change.draft).toEqual({ kind: "context", namespace: "change", field: "draft" });
  });

  it("event.type → ContextRef(event, type)", () => {
    expect(event.type).toEqual({ kind: "context", namespace: "event", field: "type" });
  });

  it("run.id → ContextRef(run, id)", () => {
    expect(run.id).toEqual({ kind: "context", namespace: "run", field: "id" });
  });

  it("run.attempt → ContextRef(run, attempt)", () => {
    expect(run.attempt).toEqual({ kind: "context", namespace: "run", field: "attempt" });
  });

  it("inputs.environment → ContextRef(inputs, environment)", () => {
    expect(inputs.environment).toEqual({ kind: "context", namespace: "inputs", field: "environment" });
  });

  it("dynamic env access via bracket notation", () => {
    expect(env["MY_CUSTOM_VAR"]).toEqual({ kind: "context", namespace: "env", field: "MY_CUSTOM_VAR" });
  });
});
