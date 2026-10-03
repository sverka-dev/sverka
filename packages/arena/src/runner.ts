/**
 * Matrix runner — executes the full arena matrix:
 *
 *   task × model × plugin combination × repetition
 *
 * For each cell it spawns the agent, runs the prompt, collects the result,
 * and kills the agent. Results are aggregated into {@link ArenaResult}.
 */

import { writeFile, mkdir, cp, rm, realpath } from "node:fs/promises";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync, type SpawnOptions } from "node:child_process";
import { fileURLToPath } from "node:url";

import type {
  ArenaConfig,
  ArenaResult,
  RunResult,
  AggregateMetrics,
  PluginConfig,
  ModelConfig,
  Task,
  CaseAnalysis,
  ComboComparison,
  CheckResult,
} from "./types.js";
import { judgeAllRuns, compareCombos } from "./judge.js";
import { installPlugins } from "./adapters/devin.js";

/** Resolve the arena package root (for fixture paths). */
const PKG_ROOT = resolve(
  typeof __dirname !== "undefined"
    ? __dirname
    : fileURLToPath(new URL(".", import.meta.url)),
  "..",
);

/**
 * Generate all plugin on/off combinations.
 *
 * For N plugins this produces 2^N combinations, each a full copy of the
 * plugins array with `enabled` set appropriately.
 *
 * - 0 plugins → `[[]]` (one empty combination)
 * - 1 plugin  → `[[off], [on]]`
 * - 2 plugins → `[[off,off], [on,off], [off,on], [on,on]]`
 */
export function pluginCombinations(plugins: PluginConfig[]): PluginConfig[][] {
  if (plugins.length === 0) return [[]];

  const combos: PluginConfig[][] = [[]];
  for (const plugin of plugins) {
    const next: PluginConfig[][] = [];
    for (const combo of combos) {
      // Disabled variant
      next.push([...combo, { ...plugin, enabled: false }]);
      // Enabled variant
      next.push([...combo, { ...plugin, enabled: true }]);
    }
    combos.length = 0;
    combos.push(...next);
  }
  return combos;
}

/**
 * Run the full arena matrix: task × model × plugin combo × repetitions.
 *
 * Each cell spawns the configured agent adapter, installs the plugin
 * combination, runs the prompt, collects trace + metrics, and kills the
 * agent. Results are written to `config.outputDir/results.json` and the
 * full {@link ArenaResult} is returned.
 */
export async function runArena(config: ArenaConfig): Promise<ArenaResult> {
  const repetitions = config.repetitions ?? 1;
  const combos = pluginCombinations(config.plugins);
  const results = await runMatrix(config, combos);

  // Run the judge on all results if configured.
  if (config.judge) {
    const verdicts = await judgeAllRuns(results, config.tasks, config.judge);
    for (const verdict of verdicts) {
      const run = results[verdict.runIndex];
      if (run) run.verdicts.push(verdict);
    }
  }

  // Build aggregates AFTER judging so judge metrics are included.
  const aggregates = buildAggregates(results, config.models, combos);
  const analysis = computeAnalysis(results, config.tasks);
  const arenaResult: ArenaResult = {
    timestamp: new Date().toISOString(),
    config: {
      models: config.models.map((m) => m.id),
      plugins: config.plugins.map((p) => p.id),
      tasks: config.tasks.map((t) => t.id),
      repetitions,
      ...(config.judge ? { judgeModel: config.judge.model.id } : {}),
    },
    results,
    aggregates,
    analysis,
  };

  await mkdir(config.outputDir, { recursive: true });
  await writeFile(
    join(config.outputDir, "results.json"),
    JSON.stringify(arenaResult, null, 2),
    "utf-8",
  );
  return arenaResult;
}

/**
 * Run every cell of the task × model × combo × repetition matrix, collecting
 * results and logging per-cell progress to stderr.
 */
async function runMatrix(
  config: ArenaConfig,
  combos: PluginConfig[][],
): Promise<RunResult[]> {
  const repetitions = config.repetitions ?? 1;
  const results: RunResult[] = [];
  for (const task of config.tasks) {
    for (const model of config.models) {
      for (const combo of combos) {
        for (let rep = 0; rep < repetitions; rep++) {
          const cellLabel = formatCell(task.id, model.id, combo, rep);
          process.stderr.write(`[arena] ${cellLabel} running...\n`);
          const result = await runCell(
            config.agent,
            task,
            model,
            combo,
            rep,
            config.workspace,
          );
          results.push(result);
          process.stderr.write(
            `[arena] ${cellLabel} ${result.success ? "PASS" : "FAIL"} — ` +
              `${result.metrics.totalTokens} tokens, ${result.metrics.toolCallCount} tools, ` +
              `${result.metrics.llmCallCount} llm calls, ${result.metrics.executionTimeMs}ms\n`,
          );
        }
      }
    }
  }
  return results;
}

/**
 * Aggregate metrics per (model × plugin combo) cell.
 */
function buildAggregates(
  results: RunResult[],
  models: ModelConfig[],
  combos: PluginConfig[][],
): AggregateMetrics[] {
  const aggregates: AggregateMetrics[] = [];
  for (const model of models) {
    for (const combo of combos) {
      const pluginIds = combo.filter((p) => p.enabled).map((p) => p.id);
      const label = formatAggregateLabel(model.id, pluginIds);
      aggregates.push(
        aggregateResults(
          results,
          (r) =>
            r.modelId === model.id && samePluginIds(r.pluginIds, pluginIds),
          label,
        ),
      );
    }
  }
  return aggregates;
}

/** Run a single matrix cell in an ISOLATED temp workspace. */
async function runCell(
  agent: ArenaConfig["agent"],
  task: ArenaConfig["tasks"][number],
  model: ArenaConfig["models"][number],
  combo: PluginConfig[],
  rep: number,
  workspaceBase?: string,
): Promise<RunResult> {
  const tempWorkspace = await createTempWorkspace(
    task,
    model,
    combo,
    rep,
    workspaceBase,
  );
  await installPlugins(tempWorkspace, combo);
  const result = await executeRun(agent, task, model, combo, tempWorkspace);
  await rm(tempWorkspace, { recursive: true, force: true });
  return result;
}

/**
 * Create an isolated temp workspace with a fresh copy of the fixture (if any).
 * Each run gets its own copy to prevent skill contamination from the host repo.
 */
async function createTempWorkspace(
  task: ArenaConfig["tasks"][number],
  model: ArenaConfig["models"][number],
  combo: PluginConfig[],
  rep: number,
  base?: string,
): Promise<string> {
  const tempWorkspace = join(
    base ?? tmpdir(),
    `arena-${task.id}-${model.id}-${combo.map((p) => p.id + (p.enabled ? "on" : "off")).join(",")}-r${rep}-${Date.now()}`,
  );
  await mkdir(tempWorkspace, { recursive: true });
  if (task.fixture) {
    const fixturePath = resolve(PKG_ROOT, task.fixture);
    // Prevent path traversal: relative fixtures must stay under PKG_ROOT.
    // Absolute paths (e.g. anchored to the config file by loadArenaConfig)
    // are trusted as intentional. realpath() catches a fixture dir that is
    // itself a symlink escaping the root.
    if (!isAbsolute(task.fixture)) {
      const real = await realpath(fixturePath);
      const realRoot = await realpath(PKG_ROOT);
      if (!real.startsWith(realRoot + sep) && real !== realRoot) {
        throw new Error(`Fixture path escapes package root: ${task.fixture}`);
      }
    }
    await cp(fixturePath, tempWorkspace, { recursive: true });
  }
  return tempWorkspace;
}

/**
 * Spawn the agent, run the prompt, run deterministic checks, and return the
 * result. On error returns a zeroed {@link RunResult} via {@link errorResult}.
 */
async function executeRun(
  agent: ArenaConfig["agent"],
  task: ArenaConfig["tasks"][number],
  model: ArenaConfig["models"][number],
  combo: PluginConfig[],
  tempWorkspace: string,
): Promise<RunResult> {
  const setupError = await runSetup(tempWorkspace, task.setup);
  if (setupError) return errorResult(task, model, combo, setupError);
  const proc = agent.spawn({
    model,
    workspace: tempWorkspace,
    plugins: combo,
    permissionMode: "dangerous",
  });
  try {
    const result = await proc.run(task.prompt, task.timeoutMs ?? 120_000);
    result.taskId = task.id;
    if (!result.verdicts) result.verdicts = [];
    if (!result.checkResults) result.checkResults = [];
    if (task.checks && task.checks.length > 0) {
      result.checkResults = await runChecks(tempWorkspace, task.checks);
      result.success =
        result.success && result.checkResults.every((c) => c.passed);
    }
    return result;
  } catch (error) {
    return errorResult(task, model, combo, error);
  } finally {
    proc.kill();
  }
}

/** Run a task's setup commands; returns the failure, or null on success. */
async function runSetup(
  workspace: string,
  setup: string[] | undefined,
): Promise<Error | null> {
  for (const command of setup ?? []) {
    try {
      const { output, exitCode } = await execShell(workspace, command);
      if (exitCode !== 0) {
        return new Error(
          `setup command failed (exit ${exitCode}): ${command}\n${output.trim()}`,
        );
      }
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }
  return null;
}

/** Build a zeroed {@link RunResult} for a failed run. */
function errorResult(
  task: ArenaConfig["tasks"][number],
  model: ArenaConfig["models"][number],
  combo: PluginConfig[],
  error: unknown,
): RunResult {
  return {
    taskId: task.id,
    modelId: model.id,
    pluginIds: combo.filter((p) => p.enabled).map((p) => p.id),
    metrics: {
      inputTokens: 0,
      outputTokens: 0,
      thoughtTokens: 0,
      totalTokens: 0,
      toolCallCount: 0,
      llmCallCount: 0,
      executionTimeMs: 0,
      stopReason: "cancelled",
    },
    trace: {
      sessionId: "",
      model: model.id,
      steps: [],
      finalMetrics: {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCachedTokens: 0,
        totalSteps: 0,
      },
    },
    output: "",
    checkResults: [],
    verdicts: [],
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Env for check subprocesses. Checks run agent-written scripts (e.g.
 * `bun run verify` executes whatever the agent left in package.json), so
 * the runner's secrets must not leak in. Allowlist toolchain basics only.
 */
export function buildCheckEnv(
  env: Record<string, string | undefined> = process.env,
  home?: string,
): Record<string, string> {
  // NODE_OPTIONS is deliberately excluded — host preload flags would inject
  // host modules into Node-based checks.
  const SAFE =
    /^(PATH|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|SYSTEMROOT|SystemRoot|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|SHELL|TERM|COLORTERM|FORCE_COLOR|NO_COLOR|LANG|LC_[A-Z_]+|USER|LOGNAME|XDG_CACHE_HOME|XDG_CONFIG_HOME|XDG_DATA_HOME|TZ|NODE_ENV|BUN_INSTALL|VIRTUAL_ENV|OSTYPE|MACHTYPE|HOSTTYPE)$/;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && SAFE.test(key)) out[key] = value;
  }
  // Redirect the credential-bearing home dirs at a fresh empty home.
  if (home) {
    out["HOME"] = home;
    out["USERPROFILE"] = home;
    out["XDG_CACHE_HOME"] = join(home, ".cache");
    out["XDG_CONFIG_HOME"] = join(home, ".config");
    out["XDG_DATA_HOME"] = join(home, ".local", "share");
    // Keep package-manager caches warm: setup ran with the host HOME and
    // populated them, and caches carry no credentials. Without this every
    // check that installs or resolves deps re-downloads the world.
    const hostHome = env["HOME"];
    if (hostHome) {
      out["BUN_INSTALL_CACHE_DIR"] =
        env["BUN_INSTALL_CACHE_DIR"] ??
        join(hostHome, ".bun", "install", "cache");
      out["npm_config_cache"] =
        env["npm_config_cache"] ?? join(hostHome, ".npm");
    }
  }
  out["CI"] = "true"; // forced — checks always see CI mode
  return out;
}

/**
 * Host dirs bound read-only into the check sandbox — the toolchain (bun,
 * node, bash, git) plus /etc. Host $HOME is deliberately absent: that is
 * what makes credentials unreachable by absolute path, not just by env.
 */
const SANDBOX_RO_DIRS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"];

/**
 * Toolchain prefixes outside the system dirs bound read-only — never a
 * wholesale parent like /opt or /home/linuxbrew, which would expose
 * arbitrary host files.
 */
const SANDBOX_RO_TOOL_DIRS = [
  "/opt/hostedtoolcache",
  "/home/linuxbrew/.linuxbrew",
];

/**
 * Toolchain subdirs under the host HOME bound read-only — binaries and
 * version managers only, never credential-bearing dirs. `~/.bun` and
 * `~/.local/bin` stay on PATH inside the sandbox without exposing
 * ~/.config, ~/.ssh or ~/.npmrc.
 */
const SANDBOX_HOME_TOOL_DIRS = [
  ".bun",
  ".local/bin",
  ".local/share/mise",
  ".local/share/pnpm",
  ".local/share/pipx",
  ".local/share/uv",
  ".cargo/bin",
  ".rustup",
  ".nvm",
  ".volta",
  ".asdf",
  ".deno",
  ".pyenv",
  ".poetry",
  ".rbenv",
  ".sdkman",
];

/**
 * Read-only bind args shared by the availability probe and the real
 * sandbox — both must mount the same view or the probe lies. A dir that
 * is inside, or equal to, the host HOME is never bound wholesale;
 * toolchain subtrees under HOME are re-exposed explicitly by
 * SANDBOX_HOME_TOOL_DIRS.
 */
function sandboxRoBinds(hostHome: string | undefined): string[] {
  const argv: string[] = [];
  for (const dir of [...SANDBOX_RO_DIRS, ...SANDBOX_RO_TOOL_DIRS]) {
    if (hostHome && (dir === hostHome || dir.startsWith(hostHome + sep)))
      continue;
    if (existsSync(dir)) argv.push("--ro-bind", dir, dir);
  }
  const resolv = resolvConfTarget(hostHome);
  if (resolv) argv.push("--ro-bind", resolv, resolv);
  return argv;
}

/**
 * Resolved /etc/resolv.conf target worth binding, or undefined. The file
 * is often a symlink (/run/systemd/resolve/* on systemd-resolved,
 * /mnt/wsl/resolv.conf on WSL) whose target lives outside the /etc bind —
 * bind the target alone so sandboxed checks keep DNS without exposing
 * the whole parent dir. A target inside host HOME is skipped like any
 * other HOME path; a plain file stays covered by the /etc bind.
 */
function resolvConfTarget(hostHome: string | undefined): string | undefined {
  try {
    const resolv = realpathSync("/etc/resolv.conf");
    if (resolv === "/etc/resolv.conf") return undefined;
    const insideHome =
      hostHome !== undefined &&
      (resolv === hostHome || resolv.startsWith(hostHome + sep));
    return insideHome ? undefined : resolv;
  } catch {
    // No usable resolv.conf target — DNS is absent inside, like /run.
    return undefined;
  }
}

/**
 * Args masking the host HOME inside the sandbox and re-exposing only the
 * allowlisted toolchain subdirs. HOME may be a symlink into a bound dir
 * — a textual containment check would miss that /usr/runner is readable
 * through /usr — so containment is tested on the resolved path while
 * tool dirs bind back at the textual HOME so PATH entries keep working.
 */
function sandboxHomeBinds(hostHome: string, roDirs: string[]): string[] {
  const resolvedHome = existsSync(hostHome) ? realpathSync(hostHome) : hostHome;
  const underBoundDir = (p: string) =>
    roDirs.some((d) => p.startsWith(d + sep));
  const argv: string[] = [];
  if (underBoundDir(resolvedHome)) argv.push("--tmpfs", resolvedHome);
  if (hostHome !== resolvedHome && underBoundDir(hostHome)) {
    argv.push("--tmpfs", hostHome);
  }
  for (const sub of SANDBOX_HOME_TOOL_DIRS) {
    const src = join(resolvedHome, sub);
    if (existsSync(src)) argv.push("--ro-bind", src, join(hostHome, sub));
  }
  return argv;
}

let bwrapDetected: boolean | undefined;
function hasBwrap(): boolean {
  // Probe a real namespace launch — `bwrap --version` says nothing about
  // whether unprivileged user namespaces are enabled on this kernel. Run
  // the full argv (tmpfs + ro/rw binds) against throwaway dirs so a
  // mount-type failure surfaces here, not on the first check.
  if (bwrapDetected !== undefined) return bwrapDetected;
  if (process.platform !== "linux") return (bwrapDetected = false);
  const probeWs = mkdtempSync(join(tmpdir(), "arena-probe-"));
  const probeHome = mkdtempSync(join(tmpdir(), "arena-probe-home-"));
  try {
    bwrapDetected =
      spawnSync(
        "bwrap", // NOSONAR — host PATH is trusted runner config
        [...buildSandboxArgv(probeWs, probeHome), "true"],
        { stdio: "ignore" },
      ).status === 0;
  } finally {
    rmSync(probeWs, { recursive: true, force: true });
    rmSync(probeHome, { recursive: true, force: true });
  }
  return bwrapDetected;
}

/**
 * bubblewrap argv wrapping a check command: fresh user+pid namespaces,
 * only the workspace and check HOME writable, toolchain dirs read-only.
 * Anything not bound (host $HOME, ~/.ssh, ~/.config) simply does not
 * exist inside — a real filesystem boundary, unlike env scrubbing.
 */
export function buildSandboxArgv(
  workspace: string,
  checkHome: string,
): string[] {
  const argv = [
    "--die-with-parent",
    "--unshare-user",
    "--uid",
    "0",
    "--gid",
    "0",
    "--unshare-pid",
    "--new-session",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
  ];
  const hostHome = process.env["HOME"];
  const roDirs = [...SANDBOX_RO_DIRS, ...SANDBOX_RO_TOOL_DIRS];
  argv.push(...sandboxRoBinds(hostHome));
  if (hostHome) argv.push(...sandboxHomeBinds(hostHome, roDirs));
  argv.push(
    "--bind",
    checkHome,
    checkHome,
    "--bind",
    workspace,
    workspace,
    "--chdir",
    workspace,
    "--",
    "bash",
    "-c",
  );
  return argv;
}

/** Run a shell command in the workspace, capturing combined output. */
function execShell(
  workspace: string,
  command: string,
  env?: Record<string, string>,
  checkHome?: string,
): Promise<{ output: string; exitCode: number }> {
  const opts: SpawnOptions = {
    cwd: workspace,
    stdio: ["pipe", "pipe", "pipe"],
    env: env ?? { ...process.env, CI: "true" },
  };
  const run = (
    sandboxed: boolean,
  ): Promise<{ output: string; exitCode: number }> =>
    new Promise((resolve, reject) => {
      const proc = sandboxed
        ? spawn(
            "bwrap", // NOSONAR — host PATH is trusted runner config
            [...buildSandboxArgv(workspace, checkHome ?? ""), command],
            opts,
          )
        : spawn("bash", ["-c", command], opts); // NOSONAR — config-author shell commands
      // Cap captured output — a noisy command must not grow memory
      // without bound. 256 KiB keeps tail diagnostics while bounding the
      // worst case.
      const MAX_OUTPUT = 256 * 1024;
      let stdout = "";
      const append = (d: Buffer): void => {
        if (stdout.length < MAX_OUTPUT) stdout += d.toString();
      };
      proc.stdout?.on("data", append);
      proc.stderr?.on("data", append);
      proc.on("close", (code: number | null) => {
        // null = killed by signal; treat as failure, not a crash source.
        resolve({ output: stdout, exitCode: code ?? -1 });
      });
      proc.on("error", reject);
    });
  if (checkHome === undefined || !hasBwrap()) return run(false);
  // No retry on sandboxed failure: the check output is child-controlled,
  // so a nonzero result can never prove the sandbox itself failed —
  // treating any marker as "retry outside" would hand agent-authored
  // commands an un-sandboxed second run. Coverage lives in hasBwrap(),
  // which probes the full argv before the first check runs.
  return run(true);
}

/**
 * Run deterministic checks in the workspace. Checks execute agent-written
 * scripts, so they get a scrubbed env (see {@link buildCheckEnv}) plus a
 * fresh empty HOME. On Linux with bubblewrap available the command also
 * runs in a mount/user/pid namespace ({@link buildSandboxArgv}) — host
 * $HOME and credentials are unreachable even via absolute paths. Without
 * bwrap the env scrub stands alone: hygiene, not a sandbox.
 */
async function runChecks(
  workspace: string,
  checks: Task["checks"],
): Promise<CheckResult[]> {
  if (!checks) return [];
  const checkHome = mkdtempSync(join(tmpdir(), "arena-check-home-"));
  const env = buildCheckEnv(process.env, checkHome);
  if (hasBwrap()) {
    // Host cache paths aren't bound inside the sandbox — point them at
    // writable dirs under the fresh check HOME instead.
    env["BUN_INSTALL_CACHE_DIR"] = join(checkHome, ".bun", "install", "cache");
    env["npm_config_cache"] = join(checkHome, ".npm");
  }
  const results: CheckResult[] = [];
  try {
    for (const check of checks) {
      try {
        const { output, exitCode } = await execShell(
          workspace,
          check.command,
          env,
          checkHome,
        );
        results.push({
          checkId: check.id,
          passed: exitCode === 0,
          output: output.trim(),
          exitCode,
        });
      } catch (error) {
        results.push({
          checkId: check.id,
          passed: false,
          output: error instanceof Error ? error.message : String(error),
          exitCode: -1,
        });
      }
    }
    return results;
  } finally {
    await rm(checkHome, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Aggregate metrics for a group of runs selected by `filter`.
 *
 * Computes averages across all matching runs. Returns zeroed metrics when
 * no runs match. Includes judge-related fields (`avgJudgeScore`,
 * `judgePassCount`) and a `label` identifying the aggregate group.
 */
export function aggregateResults(
  results: RunResult[],
  filter: (r: RunResult) => boolean,
  label = "",
): AggregateMetrics {
  const filtered = results.filter(filter);
  const n = filtered.length;
  if (n === 0) {
    return {
      totalRuns: 0,
      successCount: 0,
      avgInputTokens: 0,
      avgOutputTokens: 0,
      avgTotalTokens: 0,
      avgToolCalls: 0,
      avgLlmCalls: 0,
      avgExecutionTimeMs: 0,
      avgJudgeScore: 0,
      judgePassCount: 0,
      label,
    };
  }
  const sum = (f: (r: RunResult) => number) =>
    filtered.reduce((a, r) => a + f(r), 0);
  const round = (v: number) => Math.round(v);
  const round2 = (v: number) => Math.round(v * 100) / 100;

  // Judge scores: use verdicts[0].score (first judge verdict per run).
  const judgedRuns = filtered.filter((r) => r.verdicts.length > 0);
  const avgJudgeScore =
    judgedRuns.length === 0
      ? 0
      : round2(
          judgedRuns.reduce((a, r) => a + (r.verdicts[0]?.score ?? 0), 0) /
            judgedRuns.length,
        );
  const judgePassCount = filtered.filter(
    (r) => r.verdicts[0]?.passed === true,
  ).length;

  return {
    totalRuns: n,
    successCount: filtered.filter((r) => r.success).length,
    avgInputTokens: round(sum((r) => r.metrics.inputTokens) / n),
    avgOutputTokens: round(sum((r) => r.metrics.outputTokens) / n),
    avgTotalTokens: round(sum((r) => r.metrics.totalTokens) / n),
    avgToolCalls: round2(sum((r) => r.metrics.toolCallCount) / n),
    avgLlmCalls: round2(sum((r) => r.metrics.llmCallCount) / n),
    avgExecutionTimeMs: round(sum((r) => r.metrics.executionTimeMs) / n),
    avgJudgeScore,
    judgePassCount,
    label,
  };
}

/** Compare two plugin-id arrays for equality (order-insensitive). */
function samePluginIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const id of b) {
    if (!set.has(id)) return false;
  }
  return true;
}

/** Format a human-readable cell label for logging. */
function formatCell(
  taskId: string,
  modelId: string,
  combo: PluginConfig[],
  rep: number,
): string {
  const plugins = combo
    .map((p) => `${p.id}=${p.enabled ? "on" : "off"}`)
    .join(",");
  return `${taskId}/${modelId}/{${plugins}}#${rep}`;
}

/** Format an aggregate group label: "model-id/plugins=on,off" or "model-id/no-plugins". */
function formatAggregateLabel(modelId: string, pluginIds: string[]): string {
  if (pluginIds.length === 0) return `${modelId}/no-plugins`;
  return `${modelId}/plugins=${pluginIds.join(",")}`;
}

/** Format a plugin combo label for comparisons: "no-plugins" or comma-joined ids. */
function comboLabel(pluginIds: string[]): string {
  if (pluginIds.length === 0) return "no-plugins";
  return pluginIds.join(",");
}

// ─── Case analysis ───────────────────────────────────────────────────

/**
 * Create a synthetic "average" {@link RunResult} representing a group of
 * runs with the same plugin combo. Used to feed {@link compareCombos} which
 * operates on single runs.
 */
function averageRun(runs: RunResult[]): RunResult | null {
  if (runs.length === 0) return null;
  const n = runs.length;
  const avg = (f: (r: RunResult) => number): number =>
    Math.round(runs.reduce((a, r) => a + f(r), 0) / n);
  const avg2 = (f: (r: RunResult) => number): number =>
    Math.round((runs.reduce((a, r) => a + f(r), 0) / n) * 100) / 100;
  const first = runs[0]!;
  return {
    taskId: first.taskId,
    modelId: first.modelId,
    pluginIds: first.pluginIds,
    metrics: {
      inputTokens: avg((r) => r.metrics.inputTokens),
      outputTokens: avg((r) => r.metrics.outputTokens),
      thoughtTokens: avg((r) => r.metrics.thoughtTokens),
      totalTokens: avg((r) => r.metrics.totalTokens),
      toolCallCount: avg2((r) => r.metrics.toolCallCount),
      llmCallCount: avg2((r) => r.metrics.llmCallCount),
      executionTimeMs: avg((r) => r.metrics.executionTimeMs),
      stopReason: first.metrics.stopReason,
    },
    trace: first.trace,
    output: first.output,
    checkResults: first.checkResults ?? [],
    verdicts: first.verdicts,
    success: runs.every((r) => r.success),
  };
}

/**
 * Compute per-task analysis comparing baseline (no plugins) vs each
 * candidate plugin combo.
 *
 * For each task, groups runs by plugin combo, creates an averaged
 * representative run per group, then compares the baseline (empty
 * `pluginIds`) against every non-empty candidate combo using
 * {@link compareCombos} from `judge.ts`.
 */
export function computeAnalysis(
  results: RunResult[],
  tasks: Task[],
): CaseAnalysis[] {
  const analyses: CaseAnalysis[] = [];

  for (const task of tasks) {
    const taskRuns = results.filter((r) => r.taskId === task.id);

    // Group runs by plugin combo (order-insensitive).
    const comboGroups = new Map<string, RunResult[]>();
    for (const run of taskRuns) {
      const key = comboLabel(run.pluginIds);
      const group = comboGroups.get(key);
      if (group) {
        group.push(run);
      } else {
        comboGroups.set(key, [run]);
      }
    }

    const baselineRuns = comboGroups.get("no-plugins") ?? [];
    const baseline = averageRun(baselineRuns);
    const comparisons: ComboComparison[] = [];

    if (baseline) {
      for (const [key, candidateRuns] of comboGroups) {
        if (key === "no-plugins") continue;
        const candidate = averageRun(candidateRuns);
        if (candidate) {
          comparisons.push(compareCombos(baseline, candidate));
        }
      }
    }

    analyses.push({
      taskId: task.id,
      taskName: task.name,
      prompt: task.prompt,
      comparisons,
    });
  }

  return analyses;
}
