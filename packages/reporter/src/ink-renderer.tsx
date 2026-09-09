// @sverka/reporter — InkRenderer (interactive TUI). Spec 45.

import process from "node:process";
import { useEffect, useSyncExternalStore } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import type { Key } from "ink";
import type { RunEvent } from "@sverka/runtime";
import type { Finding, PolicyResult } from "@sverka/verification";
import type { DefinitionGraph } from "@sverka/workflow";
import type {
  FindingFilter,
  InkRenderer,
  InkRendererOptions,
  UIState,
} from "./types.js";
import { createInitialState, reduceEvent } from "./reducer.js";
import { ReporterError } from "./errors.js";
import {
  FINDING_FILTERS,
  buildStepTree,
  filterFindings,
  searchFindings,
  stepGlyph,
} from "./tui-model.js";

const SPINNER_FRAMES = ["●", "◉", "○", "◉"];
const RESERVED_LINES = 4; // header + filter bar + footer + spacing

/** Mutable store shared between the Renderer surface and the ink app. */
class TuiStore {
  state: UIState = createInitialState();
  findings: readonly Finding[] = [];
  verdict: PolicyResult | null = null;
  readonly graph: DefinitionGraph | null;
  readonly baseline: readonly string[] | undefined;
  readonly interactive: boolean;
  done = false;

  filter: FindingFilter = "all";
  search = "";
  searching = false;
  details = false;
  selected = 0;
  scroll = 0;
  spinnerFrame = 0;

  private version = 0;
  private readonly listeners = new Set<() => void>();
  private onQuit: (() => void) | null = null;

  constructor(options: InkRendererOptions) {
    this.graph = options.graph ?? null;
    this.baseline = options.baselineFingerprints;
    const stdin = options.stdin ?? process.stdin;
    this.interactive = options.interactive ?? (stdin.isTTY === true);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  setQuitHandler(fn: () => void): void {
    this.onQuit = fn;
  }

  notify(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  pushEvent(event: RunEvent): void {
    this.state = reduceEvent(this.state, event);
    this.notify();
  }

  finish(): void {
    this.done = true;
    this.notify();
    if (!this.interactive) {
      this.quit();
    }
  }

  quit(): void {
    this.onQuit?.();
  }

  hasRunning(): boolean {
    for (const s of this.state.steps.values()) {
      if (s.state === "running" || s.state === "compensating") return true;
    }
    return false;
  }

  visibleFindings(): readonly Finding[] {
    return searchFindings(
      filterFindings(this.findings, this.filter, this.baseline),
      this.search,
    );
  }

  handleInput(input: string, key: Key): void {
    if (this.searching) {
      if (key.escape || key.return) {
        this.searching = false;
      } else if (key.backspace || key.delete) {
        this.search = this.search.slice(0, -1);
      } else if (input && !key.ctrl && !key.meta) {
        this.search += input;
      }
      this.notify();
      return;
    }

    if (input === "q" || (key.ctrl && input === "c")) {
      this.quit();
      return;
    }
    if (input === "/") {
      this.searching = true;
    } else if (input === "f") {
      const i = FINDING_FILTERS.indexOf(this.filter);
      this.filter = FINDING_FILTERS[(i + 1) % FINDING_FILTERS.length] ?? "all";
    } else if (input === "d") {
      this.details = !this.details;
    } else if (input === "j" || key.downArrow) {
      const max = Math.max(0, buildStepTree(this.graph, this.state).length - 1);
      this.selected = Math.min(max, this.selected + 1);
    } else if (input === "k" || key.upArrow) {
      this.selected = Math.max(0, this.selected - 1);
    } else {
      return;
    }
    this.notify();
  }
}

/** Format a step's trailing status text. */
function stepStatusText(step: { state: string; durationMs?: number; attempt?: number }): string {
  const parts: string[] = [];
  if (step.attempt !== undefined && step.attempt > 1) {
    parts.push(`attempt ${step.attempt}`);
  }
  if (step.durationMs !== undefined) {
    parts.push(`${step.durationMs}ms`);
  }
  return parts.join(" ");
}

/** Render the search indicator based on store state. */
function renderSearchIndicator(store: TuiStore): string {
  if (store.searching) return `  /${store.search}▏`;
  if (store.search) return `  /${store.search}`;
  return "";
}

/** Map a severity to a color prop object. */
function severityColor(severity: string): { color?: string } {
  if (severity === "high" || severity === "critical") return { color: "red" };
  if (severity === "medium") return { color: "yellow" };
  return {};
}

/** Render the footer status line based on store state. */
function renderFooterStatus(store: TuiStore): string {
  if (store.verdict) {
    return `Policy: ${store.verdict.verdict.toUpperCase()} — ${store.verdict.summary}`;
  }
  if (store.done) {
    return `run ${store.state.status ?? "finished"}`;
  }
  return "running…";
}

function TuiApp({ store }: Readonly<{ store: TuiStore }>) {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const { exit } = useApp();
  const { stdout } = useStdout();

  useEffect(() => {
    store.setQuitHandler(exit);
  }, [store, exit]);

  // Spinner tick while any step is running.
  useEffect(() => {
    if (!store.hasRunning()) return;
    const timer = setInterval(() => {
      store.spinnerFrame = (store.spinnerFrame + 1) % SPINNER_FRAMES.length;
      store.notify();
    }, 120);
    return () => clearInterval(timer);
  }, [store, store.state]);

  useInput(
    (input, key) => {
      store.handleInput(input, key);
    },
    { isActive: store.interactive },
  );

  const termRows = stdout.rows || 24;
  const termCols = stdout.columns || 80;
  const rows = buildStepTree(store.graph, store.state);
  const selected = Math.min(store.selected, Math.max(0, rows.length - 1));
  const findings = store.visibleFindings();

  const detailsLines =
    store.details && rows[selected]
      ? detailsFor(store, rows[selected].stepId)
      : [];

  const available = Math.max(4, termRows - RESERVED_LINES - detailsLines.length);
  const stepsCap = Math.max(2, Math.ceil(available / 2));
  const stepWindow = windowRows(rows, selected, stepsCap);
  const findingsCap = Math.max(1, available - stepWindow.length);
  const findingRows = findings.slice(0, findingsCap);

  const maxWidth = Math.max(10, termCols - 2);

  return (
    <Box flexDirection="column">
      <Text bold>
        sverka run{store.state.planId ? ` — ${store.state.planId}` : ""}
        {store.state.status ? ` — ${store.state.status}` : ""}
        {store.state.durationMs != null ? ` (${store.state.durationMs}ms)` : ""}
      </Text>

      {stepWindow.map((row) => {
        const step = store.state.steps.get(row.stepId);
        const st = step?.state ?? "pending";
        const g = stepGlyph(st);
        const isRunning = st === "running" || st === "compensating";
        const glyph = isRunning
          ? SPINNER_FRAMES[store.spinnerFrame] ?? "●"
          : g.glyph;
        const isSel = rows[selected]?.stepId === row.stepId;
        const line = `${row.prefix}${glyph} ${row.stepId}  ${step ? stepStatusText(step) : ""}`;
        return (
          <Text
            key={row.stepId}
            {...(isSel ? {} : { color: g.color })}
            inverse={isSel}
            wrap="truncate"
          >
            {line.slice(0, maxWidth)}
          </Text>
        );
      })}

      {detailsLines.map((l) => (
        <Text key={`d-${l}`} color="gray" wrap="truncate">
          {l.slice(0, maxWidth)}
        </Text>
      ))}

      <Text>
        {"Findings "}
        {FINDING_FILTERS.map((f) => (
          <Text key={f} inverse={store.filter === f} bold={store.filter === f}>
            [{f}]
          </Text>
        ))}
        {`  (${findings.length})`}
        {renderSearchIndicator(store)}
      </Text>

      {findingRows.map((f) => (
        <Text
          key={f.id}
          {...severityColor(f.severity)}
          wrap="truncate"
        >
          {`  ${f.severity.padEnd(8)} ${f.checkId}  ${f.file}:${f.startLine}  ${f.message}`.slice(0, maxWidth)}
        </Text>
      ))}

      <Text>
        {renderFooterStatus(store)}
        {"   "}
        <Text color="gray">q quit · j/k scroll · / search · f filter · d details</Text>
      </Text>
    </Box>
  );
}

/** Detail lines for the selected step (error + diagnostics + attempt). */
function detailsFor(store: TuiStore, stepId: string): string[] {
  const step = store.state.steps.get(stepId);
  const lines: string[] = [];
  if (step?.error) lines.push(`    error: ${step.error}`);
  if (step?.attempt !== undefined) lines.push(`    attempt: ${step.attempt}`);
  for (const d of store.state.diagnostics) {
    if (d.stepId === stepId) {
      lines.push(`    ${d.severity}: ${d.message}`);
    }
  }
  return lines.length > 0 ? lines : ["    (no details)"];
}

/** Window rows around the selected index within `cap` visible rows. */
function windowRows<T>(rows: readonly T[], selected: number, cap: number): readonly T[] {
  if (rows.length <= cap) return rows;
  const start = Math.min(
    Math.max(0, selected - Math.floor(cap / 2)),
    rows.length - cap,
  );
  return rows.slice(start, start + cap);
}

/** Create the interactive terminal renderer. */
export function createInkRenderer(options: InkRendererOptions = {}): InkRenderer {
  const store = new TuiStore(options);
  let instance: ReturnType<typeof render>;
  try {
    instance = render(<TuiApp store={store} />, {
      stdout: options.stdout ?? process.stdout,
      stdin: options.stdin ?? process.stdin,
      exitOnCtrlC: true,
      patchConsole: false,
      ...(options.interactive !== undefined
        ? { interactive: options.interactive }
        : {}),
      ...(options.debug !== undefined ? { debug: options.debug } : {}),
    });
  } catch (e) {
    throw new ReporterError(
      `failed to mount ink renderer: ${e instanceof Error ? e.message : String(e)}`,
      "RENDER_ERROR",
      e,
    );
  }

  return {
    onEvent(event: RunEvent): void {
      store.pushEvent(event);
    },

    onFindings(findings: readonly Finding[]): void {
      store.findings = findings;
      store.notify();
    },

    onVerdict(result: PolicyResult): void {
      store.verdict = result;
      store.notify();
    },

    flush(): void {
      store.finish();
    },

    waitUntilExit(): Promise<void> {
      return instance.waitUntilExit().then(() => undefined);
    },
  };
}
