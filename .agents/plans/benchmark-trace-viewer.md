# Sverka Benchmark Trace Viewer — Phase 6

> **Goal:** Per-task trace viewer pages on the benchmark dashboard that show
> the original prompt, full session trace with every tool call, and prove
> Sverka code mode reduces LLM requests.

## Data source

Devin CLI stores full session transcripts at:
`~/.local/share/devin/cli/transcripts/<session-id>.json`

Each transcript contains:
- `session_id`, `agent.model_name`
- `steps[]` — each step has:
  - `source`: "system" | "agent" | "user"
  - `message`: text output (empty for tool-only steps)
  - `tool_calls[]`: `{ function_name, arguments, tool_call_id }`
  - `observation.results[]`: `{ source_call_id, content }`
  - `timestamp`
- `final_metrics`: `{ total_prompt_tokens, total_completion_tokens, total_cached_tokens, total_steps }`

## Architecture

### 1. Transcript collector (`packages/benchmark/src/collector.ts`)

After each benchmark run, copy the transcript JSON from
`~/.local/share/devin/cli/transcripts/<session-id>.json` into
`website/public/benchmark/traces/<task-id>/<agent-type>.json`

This is a post-run step — the arena runner already knows the session ID
(ACP session ID maps to Devin session ID).

### 2. Trace viewer pages (`website/public/benchmark/trace/`)

Static HTML pages, one per task:
- `/benchmark/#/trace/<task-id>` — SPA route (hash-based, no server routing needed)
- Shows:
  - **Original prompt** — the task prompt given to both agents
  - **Side-by-side trace timeline** — left: raw shell agent, right: Sverka CLI agent
  - **Each tool call** — clickable, expands to show:
    - Tool name (exec, read, write, edit, etc.)
    - Arguments (command, file path, etc.)
    - Observation/result content
    - Timestamp + duration
  - **Token counter** — running total per agent, per step
  - **LLM call counter** — each agent step = 1 LLM inference call
  - **Summary** — total LLM calls, total tokens, total tool calls, total time

### 3. Updated dashboard index (`website/public/benchmark/index.html`)

- Each task row in the comparison table becomes a link to its trace page
- Add "View trace" button per task

### 4. Trace data format

```json
{
  "taskId": "run-checks",
  "prompt": "Run all checks for this project and report results",
  "agents": {
    "raw-shell": {
      "sessionId": "just-stomach",
      "model": "GLM-5.2 High",
      "finalMetrics": {
        "totalPromptTokens": 10411147,
        "totalCompletionTokens": 24438,
        "totalCachedTokens": 10285581,
        "totalSteps": 111
      },
      "steps": [
        {
          "stepId": 9,
          "timestamp": "2026-09-04T09:24:21.188Z",
          "message": "I'll initialize my context...",
          "toolCalls": [
            {
              "functionName": "read",
              "arguments": { "file_path": "/path/to/file" }
            }
          ],
          "observations": [
            { "content": "file contents..." }
          ],
          "isLlmCall": true
        }
      ]
    },
    "sverka": {
      "sessionId": "pale-clownfish",
      "model": "GLM-5.2 High",
      "finalMetrics": { ... },
      "steps": [ ... ]
    }
  }
}
```

## Tasks

| # | Task | What | Effort |
|---|------|------|--------|
| 1 | Transcript collector | Script that copies transcript JSON after arena run, transforms to trace format | Medium |
| 2 | Trace viewer SPA | Hash-routed SPA in `website/public/benchmark/` with per-task trace pages | Medium |
| 3 | Tool call inspector | Expandable panel per tool call showing arguments + results | Medium |
| 4 | LLM call counter | Visual counter showing LLM inference calls per agent (the key metric) | Small |
| 5 | Update dashboard index | Link each task row to its trace page | Small |
| 6 | Sample trace data | Generate trace JSON from existing transcripts (builder session) to demo the viewer | Small |
| 7 | Serve via Caddy | Ensure `/benchmark/trace/` works through Caddy proxy | Trivial |

## Key insight for the proof

Each agent step with `source: "agent"` = 1 LLM inference call.
The transcript shows:
- Raw shell agent: 103 steps, 102 tool calls, 10.4M prompt tokens
- Sverka CLI agent: should have fewer steps and tool calls

The trace viewer makes this visible step-by-step:
- "Agent A made 14 exec calls to discover checks; Agent B made 1 call to `sverka check`"
- "Agent A used 6500 tokens; Agent B used 3200 tokens"
- Each LLM call is visible as a step in the timeline
