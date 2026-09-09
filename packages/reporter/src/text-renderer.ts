// @sverka/reporter — TextRenderer (I/O). Spec 43.

import type { RunEvent } from "@sverka/runtime";
import type { Finding, PolicyResult } from "@sverka/verification";
import type { Renderer, UIState, TextRendererOptions, TextWriter } from "./types.js";
import { createInitialState, reduceEvent } from "./reducer.js";

/** Create a vitest-style text renderer. */
export function createTextRenderer(options: TextRendererOptions): Renderer {
  const writer = options.writer;
  let state: UIState = createInitialState();
  let evaluateMode = false;

  return {
    onEvent(event: RunEvent): void {
      state = reduceEvent(state, event);
      printEvent(event, writer);
    },

    onFindings(findings: readonly Finding[]): void {
      evaluateMode = true;
      printFindings(findings, writer);
    },

    onVerdict(result: PolicyResult): void {
      if (!evaluateMode) return;
      writer.writeLine("");
      writer.writeLine(`Policy: ${result.verdict.toUpperCase()} — ${result.summary}`);
    },

    flush(): void {
      // No-op — text renderer writes immediately.
    },
  };
}

/** Print a single run event as a text line. */
function printEvent(event: RunEvent, writer: TextWriter): void {
  switch (event.type) {
    case "run-started":
      writer.writeLine(`\n\u25B6 run started (plan: ${event.planId})`);
      break;

    case "step-pending":
      writer.writeLine(`  \u25CB ${event.stepId}  pending`);
      break;

    case "step-ready":
      writer.writeLine(`  \u25C7 ${event.stepId}  ready`);
      break;

    case "step-started":
      writer.writeLine(`  \u25B6 ${event.stepId}  running`);
      break;

    case "step-succeeded":
      writer.writeLine(`  \u2713 ${event.stepId}  succeeded (${event.durationMs}ms)`);
      break;

    case "step-failed":
      writer.writeLine(`  \u2717 ${event.stepId}  failed (${event.durationMs}ms) \u2014 ${event.error}`);
      break;

    case "step-skipped":
      writer.writeLine(`  \u2298 ${event.stepId}  skipped`);
      break;

    case "step-cancelled":
      writer.writeLine(`  \u2298 ${event.stepId}  cancelled`);
      break;

    case "step-cache-hit":
      writer.writeLine(`  \u25D2 ${event.stepId}  cache-hit`);
      break;

    case "step-retry":
      writer.writeLine(`  \u21BA ${event.stepId}  retry (attempt ${event.attempt})`);
      break;

    case "step-suspended":
      writer.writeLine(`  \u23F8 ${event.stepId}  suspended`);
      break;

    case "step-compensating":
      writer.writeLine(`  \u21BA ${event.stepId}  compensating`);
      break;

    case "step-compensated":
      writer.writeLine(`  \u21BA ${event.stepId}  compensated: ${event.status}`);
      break;

    case "run-completed":
      writer.writeLine(`\n\u25A0 run completed: ${event.status} (${event.durationMs}ms)`);
      break;

    case "run-suspended":
      writer.writeLine(`\n\u25A0 run suspended (${event.durationMs}ms)`);
      break;

    case "run-resumed":
      writer.writeLine(`\n\u25B6 run resumed (plan: ${event.planId})`);
      break;

    case "diagnostic":
      writer.writeLine(`  ! ${event.stepId}: ${event.message}`);
      break;
  }
}

/** Print findings summary: counts by severity and checkId. */
function printFindings(findings: readonly Finding[], writer: TextWriter): void {
  if (findings.length === 0) {
    writer.writeLine("\nFindings: 0");
    return;
  }

  writer.writeLine(`\nFindings (${findings.length} total):`);

  // Group by severity then by checkId
  const bySeverity = new Map<string, Map<string, number>>();
  for (const f of findings) {
    let byCheck = bySeverity.get(f.severity);
    if (!byCheck) {
      byCheck = new Map();
      bySeverity.set(f.severity, byCheck);
    }
    byCheck.set(f.checkId, (byCheck.get(f.checkId) ?? 0) + 1);
  }

  const severityOrder = ["critical", "high", "medium", "low", "info"];
  for (const sev of severityOrder) {
    const byCheck = bySeverity.get(sev);
    if (!byCheck) continue;
    for (const [checkId, count] of byCheck) {
      writer.writeLine(`  ${sev.padEnd(7)} ${count}  ${checkId}`);
    }
  }
}
