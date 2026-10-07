// Watch supervisor for `sverka run --watch` (Spec 53).
// Re-runs on file change — debounced, coalesced, resilient: a failing run
// is a result, not a crash. Only a config-load or synth error is reported
// the same way; the loop keeps watching either way.

import { watch } from "chokidar";
import { CliError } from "../types.js";
import type { OutputWriter } from "../types.js";

const DEFAULT_IGNORED = [
  /(^|[/\\])\.git([/\\]|$)/,
  /(^|[/\\])\.sverka([/\\]|$)/,
  /(^|[/\\])node_modules([/\\]|$)/,
  /(^|[/\\])dist([/\\]|$)/,
  /(^|[/\\])coverage([/\\]|$)/,
];

export interface WatchLoopOptions {
  /** Directory to watch (project root). */
  readonly root: string;
  /** Extra files/dirs to watch (e.g. a --config path outside root). */
  readonly extraPaths?: readonly string[];
  /** One run invocation. Re-invoked per change; may re-plan internally. */
  readonly run: () => Promise<number>;
  readonly output: OutputWriter;
  /** Debounce window in ms (Spec 53: 300). */
  readonly debounceMs?: number;
  /** Abort the loop — resolves with the last run's exit code. */
  readonly signal?: AbortSignal;
  /** Extra ignore patterns (appended to the built-in set). */
  readonly ignored?: readonly (string | RegExp)[];
}

export interface WatchLoopHandle {
  /** Resolves once chokidar finished its initial scan — events before this
   *  may be swallowed as scan noise. Tests should await it before writing. */
  readonly ready: Promise<void>;
  /** Resolves when `signal` aborts and any in-flight run settles — carries
   *  the last run's exit code. */
  readonly done: Promise<number>;
}

/**
 * Watch `root` and re-run `run()` on changes. Never rejects on a run
 * failure — the failure is a result the user sees; the loop continues.
 * `done` resolves when `signal` aborts and the in-flight run (if any)
 * finished, so Ctrl+C never leaves a run printing after exit.
 */
export function watchLoop(opts: WatchLoopOptions): WatchLoopHandle {
  const debounceMs = opts.debounceMs ?? 300;
  const { output } = opts;

  let running = false;
  let pending = false;
  let stopped = false;
  let doneSettled = false;
  let lastCode = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let runCount = 0;
  let resolveDone: ((code: number) => void) | undefined;
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });

  const clearTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const settleDone = (code: number): void => {
    if (doneSettled) return;
    doneSettled = true;
    resolveDone?.(code);
  };

  const invoke = async (): Promise<void> => {
    if (running) {
      // Change while a run is in flight — coalesce into ONE follow-up run.
      pending = true;
      return;
    }
    running = true;
    pending = false;
    // A run now covers every change seen so far — a timer armed by those
    // same changes would launch a redundant follow-up.
    clearTimer();
    runCount++;
    // stderr: stdout stays clean for --format json consumers.
    output.errorLine(`watch: run #${runCount}`);
    try {
      lastCode = await opts.run();
    } catch (e) {
      // A failing run is a result, not a crash — keep watching.
      output.errorLine(
        `watch: run failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      lastCode = e instanceof CliError ? e.exitCode : 1;
    }
    running = false;
    if (stopped) {
      settleDone(lastCode);
      return;
    }
    if (pending) await invoke();
  };

  const schedule = (): void => {
    if (stopped) return;
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      void invoke();
    }, debounceMs);
  };

  const watcher = watch([opts.root, ...(opts.extraPaths ?? [])], {
    ignoreInitial: true,
    ignored: [...DEFAULT_IGNORED, ...(opts.ignored ?? [])],
  });
  let resolveReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  watcher.on("ready", () => resolveReady?.());
  watcher.on("all", schedule);
  watcher.on("error", (e) => {
    output.errorLine(
      `watch: watcher error: ${e instanceof Error ? e.message : String(e)}`,
    );
  });

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearTimer();
    await watcher.close();
    // If a run is in flight, invoke() settles `done` when it finishes so
    // its output isn't cut mid-flight.
    if (!running) settleDone(lastCode);
  };
  opts.signal?.addEventListener("abort", () => void stop(), { once: true });

  // First run happens immediately — the watcher's job is re-runs.
  void invoke();

  return { ready, done };
}
