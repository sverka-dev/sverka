/**
 * Transcript collector — reads Devin CLI transcripts and transforms them
 * to trace data for the benchmark trace viewer.
 *
 * Transcript source: ~/.local/share/devin/cli/transcripts/<session-id>.json
 * Each transcript has steps[] with source, message, timestamp, and extra.telemetry.
 * Agent steps with telemetry.operation === "inference" are LLM calls.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { writeFile, mkdir } from "node:fs/promises";

// ─── Transcript source types (raw JSON from Devin CLI) ───────────────

export interface TranscriptStep {
  step_id: number;
  source: "system" | "agent" | "user";
  message: string;
  timestamp: string;
  extra?: {
    generation_model?: string | null;
    telemetry?: {
      source?: string;
      operation?: string;
    };
  };
}

export interface TranscriptMetrics {
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cached_tokens: number;
  total_steps: number;
}

export interface Transcript {
  session_id: string;
  schema_version: string;
  agent: {
    name: string;
    version: string;
    model_name: string;
  };
  final_metrics: TranscriptMetrics;
  steps: TranscriptStep[];
}

// ─── Trace data types (transformed for viewer) ───────────────────────

export interface TraceStep {
  stepId: number;
  source: "system" | "agent" | "user";
  timestamp: string;
  message: string;
  isLlmCall: boolean;
}

export interface TraceAgentData {
  sessionId: string;
  model: string;
  finalMetrics: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCachedTokens: number;
    totalSteps: number;
  };
  llmCallCount: number;
  steps: TraceStep[];
}

export interface TraceData {
  taskId: string;
  prompt: string;
  agents: {
    "raw-shell"?: TraceAgentData;
    sverka?: TraceAgentData;
  };
}

// ─── Collector functions ─────────────────────────────────────────────

/** Default transcript directory. */
export function transcriptDir(): string {
  return join(homedir(), ".local", "share", "devin", "cli", "transcripts");
}

/** Read a transcript JSON file by session ID. */
export function readTranscript(
  sessionId: string,
  dir?: string,
): Transcript {
  const path = join(dir ?? transcriptDir(), `${sessionId}.json`);
  if (!existsSync(path)) {
    throw new Error(`Transcript not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as Transcript;
}

/** Transform a raw transcript step to a trace step. */
export function transformStep(step: TranscriptStep): TraceStep {
  const isLlmCall =
    step.source === "agent" &&
    step.extra?.telemetry?.operation === "inference";
  return {
    stepId: step.step_id,
    source: step.source,
    timestamp: step.timestamp,
    message: step.message,
    isLlmCall,
  };
}

/** Count LLM inference calls in a transcript. */
export function countLlmCalls(transcript: Transcript): number {
  return transcript.steps.filter(
    (s) =>
      s.source === "agent" &&
      s.extra?.telemetry?.operation === "inference",
  ).length;
}

/** Transform a full transcript to agent trace data. */
export function transformTranscript(
  transcript: Transcript,
  agentType: "raw-shell" | "sverka",
): TraceAgentData {
  return {
    sessionId: transcript.session_id,
    model: transcript.agent.model_name,
    finalMetrics: {
      totalPromptTokens: transcript.final_metrics.total_prompt_tokens,
      totalCompletionTokens: transcript.final_metrics.total_completion_tokens,
      totalCachedTokens: transcript.final_metrics.total_cached_tokens,
      totalSteps: transcript.final_metrics.total_steps,
    },
    llmCallCount: countLlmCalls(transcript),
    steps: transcript.steps.map(transformStep),
  };
}

/** Build a combined trace data object for a task from two transcripts. */
export function buildTraceData(
  taskId: string,
  prompt: string,
  rawShellSessionId: string,
  sverkaSessionId: string,
  dir?: string,
): TraceData {
  const rawTranscript = readTranscript(rawShellSessionId, dir);
  const sverkaTranscript = readTranscript(sverkaSessionId, dir);
  return {
    taskId,
    prompt,
    agents: {
      "raw-shell": transformTranscript(rawTranscript, "raw-shell"),
      sverka: transformTranscript(sverkaTranscript, "sverka"),
    },
  };
}

/** Write trace data to the benchmark traces directory. */
export async function writeTraceData(
  trace: TraceData,
  outputDir: string,
): Promise<string> {
  const taskDir = join(outputDir, trace.taskId);
  await mkdir(taskDir, { recursive: true });
  const path = join(taskDir, "trace.json");
  await writeFile(path, JSON.stringify(trace, null, 2), "utf-8");
  return path;
}
