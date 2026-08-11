import type {
  LocalSignal,
  LocalSignalType,
  DiscoveryExplanation,
} from "./planner.js";

const SIGNAL_TYPES: readonly LocalSignalType[] = [
  "manifest",
  "lockfile",
  "dockerfile",
  "docker-compose",
  "ci-definition",
  "monorepo-marker",
  "git-metadata",
];

/**
 * Build a `DiscoveryExplanation` from the collected signals. Pure.
 */
export function buildExplanation(
  signals: readonly LocalSignal[],
  opts: { hasBaseRef: boolean; dirty: boolean },
): DiscoveryExplanation {
  const counts = {} as Record<LocalSignalType, number>;
  for (const t of SIGNAL_TYPES) {
    counts[t] = 0;
  }
  for (const sig of signals) {
    counts[sig.type] = (counts[sig.type] ?? 0) + 1;
  }

  const parts: string[] = [];
  const total = signals.length;
  parts.push(`${total} signal${total === 1 ? "" : "s"}`);
  const nonzero = SIGNAL_TYPES.filter((t) => counts[t] > 0);
  if (nonzero.length) {
    parts.push(`(${formatSignalCounts(nonzero, counts)})`);
  }
  if (opts.dirty) {
    parts.push("working tree dirty");
  } else {
    parts.push("working tree clean");
  }
  if (!opts.hasBaseRef) {
    parts.push("no baseRef provided");
  }

  return {
    summary: parts.join(" "),
    signalCounts: counts,
  };
}

/** Format non-zero signal counts as "type=count, type=count". */
function formatSignalCounts(
  types: readonly LocalSignalType[],
  counts: Readonly<Record<LocalSignalType, number>>,
): string {
  return types.map((t) => t + "=" + counts[t]).join(", ");
}
