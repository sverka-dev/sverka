// @sverka/sarif-viewer-tui — Ink TUI component. Spec 46.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { Key } from "ink";
import { handleSearchInput, isQuitInput, type Finding } from "@sverka/verification";
import type { SortMode, ViewerFilter } from "./types.js";
import {
  SEVERITY_FILTERS,
  filterBySeverity,
  searchFindings,
  sortFindings,
} from "./filter-model.js";

/** Mutable store backing the SarifTuiApp. */
export class TuiStore {
  readonly findings: readonly Finding[];
  filter: ViewerFilter = "all";
  search = "";
  searching = false;
  sort: SortMode = "none";
  selected = 0;
  details = false;

  private version = 0;
  private readonly listeners = new Set<() => void>();
  private onQuit: (() => void) | null = null;

  constructor(findings: readonly Finding[]) {
    this.findings = findings;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  setQuitHandler(fn: () => void): void {
    this.onQuit = fn;
  }

  notify(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  quit(): void {
    this.onQuit?.();
  }

  visibleFindings(): readonly Finding[] {
    const filtered = filterBySeverity(this.findings, this.filter);
    const searched = searchFindings(filtered, this.search);
    return sortFindings(searched, this.sort);
  }

  handleInput(input: string, key: Key): void {
    if (handleSearchInput(input, key, this)) {
      this.notify();
      return;
    }

    if (isQuitInput(input, key)) {
      this.quit();
      return;
    }
    if (input === "f") {
      const i = SEVERITY_FILTERS.indexOf(this.filter);
      this.filter = SEVERITY_FILTERS[(i + 1) % SEVERITY_FILTERS.length] ?? "all";
      this.selected = Math.min(this.selected, Math.max(0, this.visibleFindings().length - 1));
    } else if (input === "s") {
      this.sort = nextSortMode(this.sort);
      this.selected = Math.min(this.selected, Math.max(0, this.visibleFindings().length - 1));
    } else if (input === "d") {
      this.details = !this.details;
    } else if (input === "j" || key.downArrow) {
      const max = Math.max(0, this.visibleFindings().length - 1);
      this.selected = Math.min(max, this.selected + 1);
    } else if (input === "k" || key.upArrow) {
      this.selected = Math.max(0, this.selected - 1);
    } else {
      return;
    }
    this.notify();
  }
}

const SORT_CYCLE: readonly SortMode[] = ["none", "severity", "file", "rule"];

function nextSortMode(mode: SortMode): SortMode {
  const i = SORT_CYCLE.indexOf(mode);
  return SORT_CYCLE[(i + 1) % SORT_CYCLE.length] ?? "none";
}

/** Map a severity to a color prop object. */
function severityColor(severity: string): { color?: string } {
  if (severity === "critical" || severity === "high") return { color: "red" };
  if (severity === "medium") return { color: "yellow" };
  return {};
}

/** Render the search indicator based on store state. */
function renderSearchIndicator(store: TuiStore): string {
  if (store.searching) return `  /${store.search}▏`;
  if (store.search) return `  /${store.search}`;
  return "";
}

/** Detail lines for the selected finding. */
function detailsForFinding(finding: Finding): string[] {
  return [
    `    rule: ${finding.rule}`,
    `    file: ${finding.file}`,
    `    lines: ${finding.startLine}–${finding.endLine}`,
    `    message: ${finding.message}`,
    ...(finding.helpUrl ? [`    help: ${finding.helpUrl}`] : []),
  ];
}

/** The standalone SARIF viewer Ink component. */
export function SarifTuiApp(props: Readonly<{ findings: readonly Finding[] }>) {
  const storeRef = useRef<TuiStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = new TuiStore(props.findings);
  }
  const store = storeRef.current;
  useSyncExternalStore(store.subscribe, store.getVersion);
  const { exit } = useApp();
  const { stdout } = useStdout();

  useEffect(() => {
    store.setQuitHandler(exit);
  }, [store, exit]);

  // Reconcile store when findings prop changes (e.g. hot-reload or re-render
  // with different data). Updates the findings array and clamps selection.
  useEffect(() => {
    if (store.findings !== props.findings) {
      (store as { findings: readonly Finding[] }).findings = props.findings;
      store.selected = Math.min(store.selected, Math.max(0, store.visibleFindings().length - 1));
      store.notify();
    }
  }, [props.findings, store]);

  useInput(
    (input, key) => {
      store.handleInput(input, key);
    },
    { isActive: true },
  );

  const termCols = stdout.columns || 80;
  const termRows = stdout.rows || 24;
  const maxWidth = Math.max(10, termCols - 2);
  const visible = store.visibleFindings();
  const selected = Math.min(store.selected, Math.max(0, visible.length - 1));
  const selectedFinding = visible[selected];

  const detailsLines =
    store.details && selectedFinding ? detailsForFinding(selectedFinding) : [];

  // Viewport: reserve rows for header, footer, and details. Only render
  // the visible window around the selected finding to avoid terminal overflow.
  const reservedRows = 4 + detailsLines.length;
  const maxVisibleRows = Math.max(1, termRows - reservedRows);
  const viewportStart = Math.min(
    Math.max(0, selected - Math.floor(maxVisibleRows / 2)),
    Math.max(0, visible.length - maxVisibleRows),
  );
  const viewportEnd = Math.min(visible.length, viewportStart + maxVisibleRows);
  const viewportItems = visible.slice(viewportStart, viewportEnd);

  return (
    <Box flexDirection="column">
      <Text bold>SARIF viewer</Text>

      <Text>
        {"Findings "}
        {SEVERITY_FILTERS.map((f) => (
          <Text key={f} inverse={store.filter === f} bold={store.filter === f}>
            [{f}]
          </Text>
        ))}
        {`  (${visible.length})`}
        {renderSearchIndicator(store)}
      </Text>

      {visible.length === 0 ? (
        <Text>No findings</Text>
      ) : (
        viewportItems.map((f, i) => {
          const actualIndex = viewportStart + i;
          return (
            <Text
              key={f.id}
              {...(actualIndex === selected ? {} : severityColor(f.severity))}
              inverse={actualIndex === selected}
              wrap="truncate"
            >
              {`  ${f.severity.padEnd(8)} ${f.checkId}  ${f.file}:${f.startLine}  ${f.message}`.slice(
                0,
                maxWidth,
              )}
            </Text>
          );
        })
      )}

      {detailsLines.map((l) => (
        <Text key={`d-${l}`} color="gray" wrap="truncate">
          {l.slice(0, maxWidth)}
        </Text>
      ))}

      <Text>
        <Text color="gray">
          q quit · j/k move · / search · f filter · s sort · d details
        </Text>
      </Text>
    </Box>
  );
}
