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

/** Glyph + label for simple step events. */
const STEP_GLYPHS: Record<string, string> = {
  "step-pending": "\u25CB pending",
  "step-ready": "\u25C7 ready",
  "step-started": "\u25B6 running",
  "step-skipped": "\u2298 skipped",
  "step-cancelled": "\u2298 cancelled",
  "step-cache-hit": "\u25D2 cache-hit",
  "step-suspended": "\u23F8 suspended",
  "step-compensating": "\u21BA compensating",
};

/** Print run-level events. */
function printRunEvent(event: RunEvent, writer: TextWriter): boolean {
  switch (event.type) {
    case "run-started":
      writer.writeLine(`\n\u25B6 run started (plan: ${event.planId})`);
      return true;
    case "run-completed":
      writer.writeLine(`\n\u25A0 run completed: ${event.status} (${event.durationMs}ms)`);
      return true;
    case "run-suspended":
      writer.writeLine(`\n\u25A0 run suspended (${event.durationMs}ms)`);
      return true;
    case "run-resumed":
      writer.writeLine(`\n\u25B6 run resumed (plan: ${event.planId})`);
      return true;
    default:
      return false;
  }
}

/** Print a single run event as a text line. */
function printEvent(event: RunEvent, writer: TextWriter): void {
  // Simple step events with glyph + label
  const simple = STEP_GLYPHS[event.type];
  if (simple) {
    const stepId = (event as { stepId: string }).stepId;
    writer.writeLine(`  ${simple.split(" ")[0]} ${stepId}  ${simple.split(" ")[1]}`);
    return;
  }

  // Run-level events
  if (printRunEvent(event, writer)) return;

  // Complex step events with additional fields
  switch (event.type) {
    case "step-succeeded":
      writer.writeLine(`  \u2713 ${event.stepId}  succeeded (${event.durationMs}ms)`);
      break;
    case "step-failed":
      writer.writeLine(`  \u2717 ${event.stepId}  failed (${event.durationMs}ms) \u2014 ${event.error}`);
      break;
    case "step-retry":
      writer.writeLine(`  \u21BA ${event.stepId}  retry (attempt ${event.attempt})`);
      break;
    case "step-compensated":
      writer.writeLine(`  \u21BA ${event.stepId}  compensated: ${event.status}`);
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
