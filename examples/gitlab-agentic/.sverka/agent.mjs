// The agentic pipeline for this example repo. `.sverka/agentic.md` is the
// discovery entry point (findConfig picks the first .sverka/*.md); its
// `extends:` pulls this module in — agent steps, safe-outputs, and
// schedules are authored here because the markdown subset is
// shell-steps only.
import {
  Project,
  Pipeline,
  AgentStep,
  ShellStep,
  Entry,
  comment,
  issue,
  schedule,
} from "@sverka/workflow";

const project = new Project("gitlab-agentic");
const pipeline = new Pipeline(project, "agents");

// Reply to "@sverka" notes on merge requests. Read-only agent job; the
// comment is applied by a separate triage__apply job in the protected
// sverka-apply environment. The prompt must ask for the `sverka-writes`
// fenced block — it is the only channel the apply job reads; prose
// replies are never posted.
const WRITES_HINT = [
  "End your reply with a fenced sverka-writes block holding a JSON array of writes, e.g.",
  "```sverka-writes",
  '[{"kind": "comment", "body": "your reply text"}]',
  "```",
].join("\n");

new AgentStep(pipeline, "triage", {
  engine: "anthropic",
  model: "claude-sonnet-4-5",
  prompt: `Triage this merge-request note and draft a short reply: \${event.comment.body}\n\n${WRITES_HINT}`,
  inputs: [{ kind: "context", namespace: "event", field: "comment.body" }],
  permissions: {
    write: [{ kind: "comment", target: "merge_request" }],
  },
});

// Welcome newly opened issues labelled "agent".
new AgentStep(pipeline, "issue-welcome", {
  engine: "anthropic",
  model: "claude-sonnet-4-5",
  prompt: `A new issue was opened: \${event.issue.title}. Suggest labels and post a welcome comment.\n\n${WRITES_HINT}`,
  inputs: [{ kind: "context", namespace: "event", field: "issue.title" }],
  permissions: {
    write: [{ kind: "comment", target: "issue" }],
  },
});

// A scheduled shell step — shows the description-guard contract.
new ShellStep(pipeline, "weekly-digest", {
  command: "./scripts/digest.sh",
});

new Entry(pipeline, "on-mr-note", {
  trigger: comment({ mention: "@sverka", on: "mergeRequest" }),
  roots: ["triage"],
});
new Entry(pipeline, "on-issue-open", {
  trigger: issue({ action: "opened", labels: ["agent"] }),
  roots: ["issue-welcome"],
});
new Entry(pipeline, "on-weekly-digest", {
  trigger: schedule("0 9 * * 1"),
  roots: ["weekly-digest"],
});

export { project };
export default project;
