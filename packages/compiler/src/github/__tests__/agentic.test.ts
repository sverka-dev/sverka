// Spec 54 — GitHub parity for the shared trigger model: comment/issue
// entries lower to issue_comment/issues events + job-level `if` gating;
// agent steps get read-only permissions and an `_apply` job. The GitLab
// contract is the spec's focus; this file pins the shared-model side.

import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import {
  Project,
  Pipeline,
  ShellStep,
  AgentStep,
  Entry,
  comment,
  issue,
  push,
} from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { compileGithub, githubCapabilities } from "../../index.js";
import { GithubTarget } from "../target.js";
import { GithubTargetError } from "../errors.js";
import type { GithubTargetGraph } from "../types.js";

function singleGraph(
  result: GithubTargetGraph | readonly GithubTargetGraph[],
): GithubTargetGraph {
  if ("jobs" in result) return result;
  return result[0]!;
}

function commentGraph(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new AgentStep(p, "triage", {
    engine: "anthropic",
    prompt: "Review ${event.comment.body} and reply",
    inputs: [{ kind: "context", namespace: "event", field: "comment.body" }],
  });
  new Entry(p, "on-comment", {
    trigger: comment({ mention: "@sverka", on: "mergeRequest" }),
    roots: ["triage"],
  });
  return synthesize(proj);
}

describe("Spec 54 — GitHub comment trigger", () => {
  it("comment() lowers to issue_comment event + gated job if", () => {
    const graph = singleGraph(new GithubTarget().lower(commentGraph()));
    expect(graph.on.issue_comment).toEqual({ types: ["created"] });
    const job = graph.jobs.find((j) => j.id === "triage")!;
    expect(job.if).toContain("github.event_name == 'issue_comment'");
    expect(job.if).toContain("github.event.issue.pull_request");
    expect(job.if).toContain("contains(github.event.comment.body, '@sverka')");
  });

  it("comment({on: 'commit'}) is rejected — no Actions event exists", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "make build" });
    new Entry(p, "on-comment", {
      trigger: comment({ on: "commit" }),
      roots: ["build"],
    });
    expect(() => new GithubTarget().lower(synthesize(proj))).toThrowError(
      GithubTargetError,
    );
  });

  it("push job in a comment+push pipeline is gated to push events only", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "make build" });
    new AgentStep(p, "triage", { engine: "stub", prompt: "x" });
    new Entry(p, "on-push", { trigger: push(), roots: ["build"] });
    new Entry(p, "on-comment", {
      trigger: comment({ mention: "@sverka" }),
      roots: ["triage"],
    });
    const graph = singleGraph(new GithubTarget().lower(synthesize(proj)));
    const build = graph.jobs.find((j) => j.id === "build")!;
    const triage = graph.jobs.find((j) => j.id === "triage")!;
    expect(build.if).toBe("${{ github.event_name == 'push' }}");
    expect(triage.if).toContain("issue_comment");
    expect(triage.if).not.toContain("'push'");
  });
});

describe("Spec 54 — GitHub issue trigger", () => {
  it("issue({action, labels}) lowers to issues event + gated job if", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new AgentStep(p, "labeler", { engine: "stub", prompt: "x" });
    new Entry(p, "on-issue", {
      trigger: issue({ action: "opened", labels: ["agent"] }),
      roots: ["labeler"],
    });
    const graph = singleGraph(new GithubTarget().lower(synthesize(proj)));
    expect(graph.on.issues).toEqual({ types: ["opened"] });
    const job = graph.jobs.find((j) => j.id === "labeler")!;
    expect(job.if).toContain("github.event_name == 'issues'");
    expect(job.if).toContain("github.event.action == 'opened'");
    expect(job.if).toContain(
      "contains(github.event.issue.labels.*.name, 'agent')",
    );
  });
});

describe("Spec 54 — GitHub agent job", () => {
  it("agent job is read-only and runs sverka agent with SVERKA_AGENT_* env", () => {
    const graph = singleGraph(new GithubTarget().lower(commentGraph()));
    const job = graph.jobs.find((j) => j.id === "triage")!;
    expect(job.permissions).toEqual({
      contents: "read",
      issues: "read",
      "pull-requests": "read",
    });
    const agentStep = job.steps.find((s) => s.run?.includes("sverka@"))!;
    expect(agentStep.run).toContain(" agent");
    expect(agentStep.env?.SVERKA_AGENT_ENGINE).toBe("anthropic");
    expect(agentStep.env?.SVERKA_AGENT_PROMPT).toContain(
      "github.event.comment.body",
    );
    expect(agentStep.env?.SVERKA_MENTION).toBe("@sverka");
    const upload = job.steps.find((s) =>
      s.uses?.startsWith("actions/upload-artifact@"),
    )!;
    expect(upload.if).toBe("always()");
    expect(upload.with?.name).toBe("triage-agent-writes");
  });
});

describe("Spec 54 — GitHub _apply job", () => {
  function writeGraph(): ReturnType<typeof synthesize> {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new AgentStep(p, "triage", {
      engine: "stub",
      prompt: "Summarize",
      permissions: {
        write: [{ kind: "comment", target: "issue" }],
      },
    });
    new Entry(p, "on-comment", {
      trigger: comment({ mention: "@sverka" }),
      roots: ["triage"],
    });
    return synthesize(proj);
  }

  it("agent step with permissions.write emits a gated _apply job", () => {
    const graph = singleGraph(new GithubTarget().lower(writeGraph()));
    const apply = graph.jobs.find((j) => j.id === "triage_apply")!;
    expect(apply).toBeDefined();
    expect(apply.needs).toEqual(["triage"]);
    expect(apply.permissions).toEqual({ issues: "write" });
    expect(apply.if).toContain("issue_comment");
    const download = apply.steps.find((s) =>
      s.uses?.startsWith("actions/download-artifact@"),
    )!;
    expect(download.with?.name).toBe("triage-agent-writes");
    const run = apply.steps.find((s) => s.run?.includes("sverka@"))!;
    expect(run.run).toContain("apply --provider github");
    expect(run.env?.SVERKA_WRITE_DECLARATIONS).toBe(
      JSON.stringify([{ kind: "comment", target: "issue" }]),
    );
    // The agent job holds no write token.
    const agent = graph.jobs.find((j) => j.id === "triage")!;
    expect(JSON.stringify(agent.permissions)).not.toContain("write");
  });

  it("emitted workflow YAML parses", () => {
    const content = compileGithub(writeGraph()).artifacts[0]!.content;
    const yaml = parse(content);
    expect(yaml.on.issue_comment).toEqual({ types: ["created"] });
    expect(yaml.jobs.triage_apply.needs).toBe("triage");
  });
});

describe("Spec 54 — GitHub capabilities", () => {
  it("comment/issue triggers + agent.step marked", () => {
    expect(githubCapabilities["trigger.comment"]).toBe("native");
    expect(githubCapabilities["trigger.issue"]).toBe("native");
    expect(githubCapabilities["agent.step"]).toBe("emulated");
  });
});
