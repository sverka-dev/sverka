// @sverka/reporter — TextRenderer (I/O). Spec 43.

import type { RunEvent } from "@sverka/runtime";
import type { Finding, PolicyResult } from "@sverka/verification";
import type {
  Renderer,
  UIState,
  TextRendererOptions,
  TextWriter,
} from "./types.js";
import { createInitialState, reduceEvent } from "./reducer.js";

/** Create a vitest-style text renderer. */
export function createTextRenderer(options: TextRendererOptions): Renderer {
  const writer = options.writer;
  const color = options.color === true;
  const stepOutputLines = options.stepOutputLines ?? 20;
  let state: UIState = createInitialState();
  let evaluateMode = false;

  return {
    onEvent(event: RunEvent): void {
      state = reduceEvent(state, event);
      printEvent(event, writer, color, stepOutputLines);
    },

    onFindings(findings: readonly Finding[]): void {
      evaluateMode = true;
      printFindings(findings, writer);
    },

    onVerdict(result: PolicyResult): void {
      if (!evaluateMode) return;
      writer.writeLine("");
      writer.writeLine(
        `Policy: ${result.verdict.toUpperCase()} — ${result.summary}`,
      );
    },

    flush(): void {
      // No-op — text renderer writes immediately.
    },
  };
}

const ANSI = {
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  cyan: 36,
  gray: 90,
} as const;

function paint(enabled: boolean, code: number, text: string): string {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

/** Glyph + label + color for simple step events. */
const STEP_STYLE: Record<
  string,
  { glyph: string; label: string; code: number }
> = {
  "step-pending": { glyph: "○", label: "pending", code: ANSI.gray },
  "step-ready": { glyph: "◇", label: "ready", code: ANSI.gray },
  "step-started": { glyph: "▶", label: "running", code: ANSI.cyan },
  "step-skipped": { glyph: "⊘", label: "skipped", code: ANSI.gray },
  "step-cancelled": { glyph: "⊘", label: "cancelled", code: ANSI.gray },
  "step-cache-hit": { glyph: "◒", label: "cache-hit", code: ANSI.green },
  "step-suspended": { glyph: "⏸", label: "suspended", code: ANSI.yellow },
  "step-compensating": {
    glyph: "↺",
    label: "compensating",
    code: ANSI.yellow,
  },
};

/** Print run-level events. */
function printRunEvent(
  event: RunEvent,
  writer: TextWriter,
  color: boolean,
): boolean {
  switch (event.type) {
    case "run-started":
      writer.writeLine(
        `\n${paint(color, ANSI.cyan, "▶")} run started (plan: ${event.planId})`,
      );
      return true;
    case "run-completed": {
      const ok = event.status === "success";
      const head = paint(
        color,
        ok ? ANSI.green : ANSI.red,
        `■ run completed: ${event.status}`,
      );
      writer.writeLine(`\n${head} (${event.durationMs}ms)`);
      return true;
    }
    case "run-suspended":
      writer.writeLine(
        `\n${paint(color, ANSI.yellow, "■")} run suspended (${event.durationMs}ms)`,
      );
      return true;
    case "run-resumed":
      writer.writeLine(
        `\n${paint(color, ANSI.cyan, "▶")} run resumed (plan: ${event.planId})`,
      );
      return true;
    default:
      return false;
  }
}

/** Strip terminal escapes and control bytes from a captured output line —
 * a step's stdout/stderr is untrusted text that could spoof status lines
 * or alter terminal state (OSC 8 links, CSI erasures, rogue colors). */
function sanitizeLine(line: string): string {
  return line
    .replace(/\u001b\][^\x07\u001b]*(?:\x07|\u001b\\)/g, "") // OSC … BEL/ST
    .replace(/\u001b\[[0-9;:>?]*[ -/]*[@-~]/g, "") // CSI
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ""); // stray controls
}

/** Print the tail of a captured stream, dimmed and indented. A `label`
 * (e.g. "stderr") marks the stream when both may be present. */
function printCaptured(
  text: string | undefined,
  maxLines: number,
  writer: TextWriter,
  color: boolean,
  label?: string,
): void {
  if (maxLines <= 0 || !text) return;
  // Split on all line breaks — a lone \r would otherwise move the cursor
  // to column 0 and overwrite rendered lines in a real terminal.
  const lines = text.split(/\r\n|\r|\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return;
  if (label !== undefined) {
    writer.writeLine(`      ${paint(color, ANSI.dim, label)}`);
  }
  const shown = lines.slice(-maxLines);
  const hidden = lines.length - shown.length;
  if (hidden > 0) {
    writer.writeLine(`      … (${hidden} earlier lines)`);
  }
  for (const line of shown) {
    writer.writeLine(`      ${paint(color, ANSI.dim, sanitizeLine(line))}`);
  }
}

/** Print a single run event as a text line. */
function printEvent(
  event: RunEvent,
  writer: TextWriter,
  color: boolean,
  stepOutputLines: number,
): void {
  // Simple step events with glyph + label
  const style = STEP_STYLE[event.type];
  if (style) {
    const stepId = (event as { stepId: string }).stepId;
    writer.writeLine(
      `  ${paint(color, style.code, style.glyph)} ${stepId}  ${paint(color, style.code, style.label)}`,
    );
    return;
  }

  // Run-level events
  if (printRunEvent(event, writer, color)) return;

  // Complex step events with additional fields
  switch (event.type) {
    case "step-succeeded":
      writer.writeLine(
        `  ${paint(color, ANSI.green, "✓")} ${event.stepId}  ${paint(color, ANSI.green, "succeeded")} (${event.durationMs}ms)`,
      );
      printCaptured(event.stdout, stepOutputLines, writer, color);
      printCaptured(event.stderr, stepOutputLines, writer, color, "stderr:");
      break;
    case "step-failed":
      writer.writeLine(
        `  ${paint(color, ANSI.red, "✗")} ${event.stepId}  ${paint(color, ANSI.red, "failed")} (${event.durationMs}ms) — ${event.error}`,
      );
      printCaptured(event.stdout, stepOutputLines, writer, color);
      printCaptured(event.stderr, stepOutputLines, writer, color, "stderr:");
      break;
    case "step-retry":
      writer.writeLine(
        `  ${paint(color, ANSI.yellow, "↺")} ${event.stepId}  retry (attempt ${event.attempt})`,
      );
      break;
    case "step-compensated":
      writer.writeLine(
        `  ${paint(color, ANSI.yellow, "↺")} ${event.stepId}  compensated: ${event.status}`,
      );
      break;
    case "diagnostic":
      writer.writeLine(
        `  ${paint(color, ANSI.yellow, "!")} ${event.stepId}: ${event.message}`,
      );
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
