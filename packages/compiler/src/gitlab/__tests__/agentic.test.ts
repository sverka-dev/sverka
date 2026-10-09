// Spec 54 — GitLab agentic workflows: comment/issue triggers, schedule
// description guard, agent job emulation, and the safe-outputs __apply
// job contract.

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
  schedule,
  push,
} from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { compileGitlab, gitlabCapabilities } from "../../index.js";
import { GitlabTarget } from "../target.js";
import type { GitlabTargetGraph } from "../types.js";

function singleGraph(
  result: GitlabTargetGraph | readonly GitlabTargetGraph[],
): GitlabTargetGraph {
  if ("jobs" in result) return result;
  return result[0]!;
}

function commentGraph(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new AgentStep(p, "triage", {
    engine: "anthropic",
    model: "claude-sonnet-4-5",
    prompt: "Review ${event.comment.body} and reply",
    inputs: [{ kind: "context", namespace: "event", field: "comment.body" }],
  });
  new Entry(p, "on-comment", {
    trigger: comment({ mention: "@sverka", on: "mergeRequest" }),
    roots: ["triage"],
  });
  return synthesize(proj);
}

function agentWriteGraph(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new AgentStep(p, "triage", {
    engine: "anthropic",
    prompt: "Summarize the MR",
    permissions: {
      write: [{ kind: "comment", target: "merge_request" }],
    },
  });
  new Entry(p, "on-comment", {
    trigger: comment({ mention: "@sverka", on: "mergeRequest" }),
    roots: ["triage"],
  });
  return synthesize(proj);
}

describe("Spec 54 — GitLab comment trigger rules", () => {
  it("test 1: comment({mention, on: mergeRequest}) lowers to webhook-contract rule", () => {
    const graph = commentGraph();
    const targetGraph = singleGraph(new GitlabTarget().lower(graph));
    const job = targetGraph.jobs[0]!;
    const rule = job.rules?.[0];
    expect(rule?.if).toContain('$SVERKA_EVENT == "comment"');
    expect(rule?.if).toContain('$SVERKA_COMMENT_ON == "merge_request"');
    expect(rule?.if).toContain(String.raw`$COMMENT_BODY =~ /\x40sverka/`);
    // Pipeline source must be trigger (webhook → trigger token) or web.
    expect(rule?.if).toContain('$CI_PIPELINE_SOURCE == "trigger"');
    expect(rule?.if).toContain('$CI_PIPELINE_SOURCE == "web"');
  });

  it("test 1b: unmatched mention/object kind does not match the rule shape", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "make build" });
    new Entry(p, "on-comment", {
      trigger: comment({ mention: "@deploy", on: "issue" }),
      roots: ["build"],
    });
    const targetGraph = singleGraph(new GitlabTarget().lower(synthesize(proj)));
    const rule = targetGraph.jobs[0]!.rules?.[0];
    expect(rule?.if).toContain('$SVERKA_COMMENT_ON == "issue"');
    expect(rule?.if).toContain(String.raw`$COMMENT_BODY =~ /\x40deploy/`);
    expect(rule?.if).not.toContain("merge_request");
    expect(rule?.if).not.toContain("@sverka");
  });

  it("comment() without filters lowers to the event+source rule only", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "make build" });
    new Entry(p, "on-comment", { trigger: comment(), roots: ["build"] });
    const targetGraph = singleGraph(new GitlabTarget().lower(synthesize(proj)));
    const rule = targetGraph.jobs[0]!.rules?.[0];
    expect(rule?.if).toBe(
      '($CI_PIPELINE_SOURCE == "trigger" || $CI_PIPELINE_SOURCE == "web") && $SVERKA_EVENT == "comment"',
    );
  });
});

describe("Spec 54 — GitLab issue trigger rules", () => {
  it("test 2: issue({action, labels}) lowers to event + action + label regex", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new AgentStep(p, "triage", {
      engine: "anthropic",
      prompt: "Label the issue",
    });
    new Entry(p, "on-issue", {
      trigger: issue({ action: "opened", labels: ["agent"] }),
      roots: ["triage"],
    });
    const targetGraph = singleGraph(new GitlabTarget().lower(synthesize(proj)));
    const rule = targetGraph.jobs[0]!.rules?.[0];
    expect(rule?.if).toContain('$SVERKA_EVENT == "issue"');
    expect(rule?.if).toContain('$SVERKA_ISSUE_ACTION == "opened"');
    expect(rule?.if).toContain("$SVERKA_ISSUE_LABELS =~ /(^|,)agent(,|$)/");
  });

  it("issue labels are regex-escaped", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "make build" });
    new Entry(p, "on-issue", {
      trigger: issue({ labels: ["a.b+c"] }),
      roots: ["build"],
    });
    const targetGraph = singleGraph(new GitlabTarget().lower(synthesize(proj)));
    const rule = targetGraph.jobs[0]!.rules?.[0];
    expect(rule?.if).toContain("$SVERKA_ISSUE_LABELS =~ /(^|,)a\\.b\\+c(,|$)/");
  });
});

describe("Spec 54 — GitLab schedule description guard", () => {
  it("test 3: schedule entry guards on CI_PIPELINE_SCHEDULE_DESCRIPTION == entry name", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "nightly", { command: "make nightly" });
    new Entry(p, "weekly-report", {
      trigger: schedule("0 9 * * 1"),
      roots: ["nightly"],
    });
    const targetGraph = singleGraph(new GitlabTarget().lower(synthesize(proj)));
    const rule = targetGraph.jobs[0]!.rules?.[0];
    expect(rule?.if).toBe(
      '$CI_PIPELINE_SOURCE == "schedule" && $CI_PIPELINE_SCHEDULE_DESCRIPTION == "weekly-report"',
    );
  });

  it("schedule annotation documents the GitLab-side setup", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "nightly", { command: "make nightly" });
    new Entry(p, "weekly-report", {
      trigger: schedule("0 9 * * 1", "UTC"),
      roots: ["nightly"],
    });
    const content = compileGitlab(synthesize(proj)).artifacts[0]!.content;
    expect(content).toContain("sverka:schedule:");
    expect(content).toContain('"0 9 * * 1"');
    expect(content).toContain('"weekly-report"');
  });
});

describe("Spec 54 — webhook contract annotations", () => {
  it("comment/issue entries emit the sverka:webhook setup annotation", () => {
    const content = compileGitlab(commentGraph()).artifacts[0]!.content;
    expect(content).toContain("# sverka:webhook:");
    expect(content).toContain("SVERKA_EVENT=comment|issue");
    expect(content).toContain("trigger/pipeline");
  });
});

describe("Spec 54 — agent job emulation", () => {
  it("agent step lowers to a sverka agent invocation with SVERKA_AGENT_* variables", () => {
    const targetGraph = singleGraph(new GitlabTarget().lower(commentGraph()));
    const job = targetGraph.jobs[0]!;
    expect(job.script.join("\n")).toMatch(/npx -y sverka@\d+\.\d+\.\d+ agent/);
    expect(job.variables?.SVERKA_AGENT_ENGINE).toBe("anthropic");
    expect(job.variables?.SVERKA_AGENT_MODEL).toBe("claude-sonnet-4-5");
    expect(job.variables?.SVERKA_AGENT_PROMPT).toContain("$COMMENT_BODY");
    // Mention metadata rides into the job for the in-sandbox re-check.
    expect(job.variables?.SVERKA_MENTION).toBe("@sverka");
    expect(job.artifacts?.paths).toContain("agent-result.json");
    expect(job.artifacts?.paths).toContain("sverka-writes.json");
    // The agent job never receives write-side variables.
    expect(job.variables?.SVERKA_APPLY_TOKEN).toBeUndefined();
    for (const key of Object.keys(job.variables ?? {})) {
      expect(key.startsWith("SV_WRITE_")).toBe(false);
    }
  });

  it("multiple agent operations in one step fail lowering", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    // Two AgentSteps can't share a step id; construct the graph shape the
    // IR allows (one step, two agent ops) by hand via definitions.
    const step = new AgentStep(p, "a", { engine: "stub", prompt: "x" });
    void step;
    new Entry(p, "on-push", { trigger: push(), roots: ["a"] });
    const graph = synthesize(proj);
    const def = graph.project.pipelines[0]!;
    const stepDef = def.steps[0]!;
    const doubled = {
      ...stepDef,
      operations: [...stepDef.operations, ...stepDef.operations],
    };
    const hacked = {
      ...graph,
      project: {
        ...graph.project,
        pipelines: [{ ...def, steps: [doubled] }],
      },
    };
    expect(() => new GitlabTarget().lower(hacked)).toThrowError(
      /multiple agent operations/,
    );
  });
});

describe("Spec 54 — safe-outputs __apply job", () => {
  it("test 4: agent step with permissions.write emits exactly one __apply job", () => {
    const targetGraph = singleGraph(
      new GitlabTarget().lower(agentWriteGraph()),
    );
    const applyJobs = targetGraph.jobs.filter((j) => j.id.endsWith("__apply"));
    expect(applyJobs).toHaveLength(1);
    const apply = applyJobs[0]!;
    expect(apply.stage).toBe("sverka-apply");
    expect(apply.environment?.name).toBe("sverka-apply");
    expect(apply.needs).toContain("triage");
    expect(apply.script?.join("\n")).toContain("sverka@");
    expect(apply.script?.join("\n")).toContain("apply --provider gitlab");
    // The write policy is pinned on the script line — a job-level
    // `variables:` entry could be overridden by trigger-supplied vars.
    expect(apply.script?.join("\n")).toContain(
      `SVERKA_WRITE_DECLARATIONS='${JSON.stringify([{ kind: "comment", target: "merge_request" }])}'`,
    );
    expect(apply.variables?.SVERKA_WRITE_DECLARATIONS).toBeUndefined();
    // The apply job inherits the agent job's entry rules (same pipeline filter).
    expect(apply.rules?.[0]?.if).toContain('$SVERKA_EVENT == "comment"');
    // Stages put sverka-apply last.
    expect(targetGraph.stages[targetGraph.stages.length - 1]).toBe(
      "sverka-apply",
    );
  });

  it("agent job stays free of write variables; non-agent writes keep SV_WRITE_*", () => {
    const targetGraph = singleGraph(
      new GitlabTarget().lower(agentWriteGraph()),
    );
    const agent = targetGraph.jobs.find((j) => j.id === "triage")!;
    const varKeys = Object.keys(agent.variables ?? {});
    expect(varKeys).not.toContain("SVERKA_APPLY_TOKEN");
    expect(varKeys.filter((k) => k.startsWith("SV_WRITE_"))).toHaveLength(0);
  });

  it("apply annotation documents the protected environment contract", () => {
    const content = compileGitlab(agentWriteGraph()).artifacts[0]!.content;
    expect(content).toContain("sverka:apply:");
    expect(content).toContain("SVERKA_APPLY_TOKEN");
    expect(content).toContain("environment:");
    expect(content).toContain("sverka-apply");
  });

  it("apply job inherits the agent job's image and runner tags", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new AgentStep(p, "triage", {
      engine: "anthropic",
      prompt: "x",
      runtime: { mode: "container", image: "node:22" },
      runner: { labels: ["docker", "gpu"] },
      permissions: {
        write: [{ kind: "comment", target: "merge_request" }],
      },
    });
    new Entry(p, "on-comment", {
      trigger: comment({ mention: "@sverka", on: "mergeRequest" }),
      roots: ["triage"],
    });
    const targetGraph = singleGraph(new GitlabTarget().lower(synthesize(proj)));
    const apply = targetGraph.jobs.find((j) => j.id === "triage__apply")!;
    // Tagged-only runners never pick up untagged jobs, and apply needs
    // the agent job's toolchain (npx) to run `sverka apply`.
    expect(apply.image).toBe("node:22");
    expect(apply.tags).toEqual(["docker", "gpu"]);
  });

  it("agent step combining matrix with writes fails lowering", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new AgentStep(p, "triage", {
      engine: "anthropic",
      prompt: "x",
      matrix: { dimensions: { model: ["a", "b"] } },
      permissions: {
        write: [{ kind: "comment", target: "merge_request" }],
      },
    });
    new Entry(p, "on-comment", {
      trigger: comment({ mention: "@sverka", on: "mergeRequest" }),
      roots: ["triage"],
    });
    // Matrix legs share the sverka-writes.json artifact name — a single
    // apply job cannot disambiguate them.
    expect(() => new GitlabTarget().lower(synthesize(proj))).toThrowError(
      /matrix/,
    );
  });

  it("agent step declaring the sverka-apply environment fails lowering", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new AgentStep(p, "triage", {
      engine: "anthropic",
      prompt: "x",
      environment: { name: "sverka-apply" },
    });
    new Entry(p, "on-comment", {
      trigger: comment({ mention: "@sverka", on: "mergeRequest" }),
      roots: ["triage"],
    });
    // The apply environment holds the write-scoped token — agent jobs
    // must not be placed into it.
    expect(() => new GitlabTarget().lower(synthesize(proj))).toThrowError(
      /sverka-apply/,
    );
  });

  it("non-agent step with permissions.write does NOT get an __apply job", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "deploy", {
      command: "deploy",
      permissions: { write: [{ kind: "deploy", target: "prod" }] },
    });
    new Entry(p, "on-push", { trigger: push(), roots: ["deploy"] });
    const targetGraph = singleGraph(new GitlabTarget().lower(synthesize(proj)));
    expect(
      targetGraph.jobs.filter((j) => j.id.endsWith("__apply")),
    ).toHaveLength(0);
    expect(targetGraph.stages).not.toContain("sverka-apply");
  });
});

describe("Spec 54 — capability manifest", () => {
  it("test 6: gitlab marks comment/issue triggers + agent.step as emulated", () => {
    expect(gitlabCapabilities["trigger.comment"]).toBe("emulated");
    expect(gitlabCapabilities["trigger.issue"]).toBe("emulated");
    expect(gitlabCapabilities["agent.step"]).toBe("emulated");
  });
});

describe("Spec 54 — emitted YAML validity", () => {
  it("test 8: full agentic pipeline emits parseable .gitlab-ci.yml", () => {
    const content = compileGitlab(agentWriteGraph()).artifacts[0]!.content;
    const yaml = parse(content);
    expect(yaml.stages).toContain("sverka-apply");
    expect(yaml.triage).toBeDefined();
    expect(yaml["triage__apply"].environment.name).toBe("sverka-apply");
    expect(yaml["triage__apply"].script.join(" ")).toContain(
      "apply --provider gitlab",
    );
  });
});
