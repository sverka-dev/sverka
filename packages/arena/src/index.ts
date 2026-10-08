export type {
  AgentAdapter,
  AgentSpawnConfig,
  AgentProcess,
  ModelConfig,
  PluginConfig,
  Task,
  DeterministicCheck,
  CheckResult,
  ArenaConfig,
  RunResult,
  RunMetrics,
  TraceData,
  TraceStep,
  ToolCall,
  Observation,
  AggregateMetrics,
  ArenaResult,
  JudgeConfig,
  JudgeVerdict,
  CaseAnalysis,
  ComboComparison,
} from "./types.js";

export { DevinAdapter } from "./adapters/devin.js";
export {
  installPlugins,
  transcriptDir,
  countLlmCalls,
} from "./adapters/devin.js";

export { sanitizeEnv, runAcpSession, createPermissionHandler } from "./acp.js";
export type { ToolCallMessage, ToolCallUpdateMessage } from "./acp.js";
export { extractUsageTokens } from "./adapters/devin.js";

export {
  pluginCombinations,
  runArena,
  aggregateResults,
  computeAnalysis,
} from "./runner.js";

export {
  judgeAllRuns,
  judgeRun,
  buildJudgePrompt,
  parseJudgeResponse,
  compareCombos,
  DEFAULT_JUDGE_PROMPT,
} from "./judge.js";

export {
  ArenaError,
  defineConfig,
  loadArenaConfig,
  resolveAdapter,
} from "./config.js";
export type { ArenaConfigFile } from "./config.js";
export { renderReport } from "./report.js";

export {
  traceToActions,
  traceToRunEvents,
  traceGraph,
  writeTraceReport,
} from "./trace-report.js";
export type { ActionStep } from "./trace-report.js";

export {
  arenaResultGraph,
  arenaResultToEvents,
  runStepId,
  writeAggregateReport,
} from "./aggregate-report.js";

// Spec 56 — arena eval service: registry + leaderboard + task packs.
export {
  arenaResultV1Schema,
  parseArenaResultV1,
  promptHash,
  resultPath,
  createFileRegistry,
  createGitRegistry,
  createS3Registry,
  openRegistry,
  reindexRegistry,
  resolveRegistryDir,
  publishBatch,
} from "./registry.js";
export type {
  ArenaResultV1,
  TaskResult,
  ArenaRegistry,
  PublishOptions,
  TraceInput,
  ListQuery,
  GitRegistryConfig,
  S3RegistryConfig,
  S3ClientLike,
} from "./registry.js";

export {
  newRunId,
  explodeResult,
  publishResult,
  publishFile,
} from "./publish.js";
export type { PublishContext } from "./publish.js";

export {
  buildBoard,
  renderBoard,
  renderBoardHtml,
  sparkline,
} from "./board.js";
export type { BoardRow, BoardCohort, BuildBoardOptions } from "./board.js";

export { initPack, lintPack, loadPack, resolvePack } from "./pack.js";
export type {
  TaskPack,
  PackDefaults,
  PackLint,
  ResolvePackOptions,
} from "./pack.js";

export type { ArenaErrorCode } from "./config.js";
