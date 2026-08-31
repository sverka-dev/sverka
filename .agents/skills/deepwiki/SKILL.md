---
name: deepwiki
description: Analyze public GitHub repositories using DeepWiki's AI-generated documentation. Use when code from a GitHub repo must be analyzed, scanned, or understood. Spawns a background subagent so analysis never blocks the current thread.
---

# DeepWiki — GitHub Repository Analysis

Use DeepWiki to analyze, scan, or understand any **public** GitHub repository.
DeepWiki generates AI-powered documentation wikis and can answer questions
grounded in a repo's actual code.

## Scope discipline — the leak rule

DeepWiki chat (`ask_question`) is grounded in a single repo's code —
**the repo you pass as `repoName`**. Two failure modes if the prompt is
sloppy:

1. The model **confabulates** a mapping from your internal concept to
   the target repo (it has no way to verify your concept exists there).
   The answer comes back sounding authoritative and is wrong.
2. You **leak** the shape of your internal design — file paths,
   internal class names, env names, customer terminology — to a
   third-party service that has no business knowing them.

**Rules for the chat prompt:**

- **Always pass `repoName` first**, on every call. Never invoke
  `ask_question` without it — the answer must be drawn from one
  target repo's corpus.
- **Phrase in the target repo's vocabulary** — class names, function
  names, file names that actually appear in the target. If you don't
  know them, `read_wiki_structure` first.
- **Do not include** the current project's: file paths, internal
  class names, env / customer / org-specific terminology, or anything
  you'd redact from a public post.
- **If you need a mapping** between an internal concept and the
  target, ask in general terms first
  ("How is request validation typically done in Express?"), confirm,
  then ask the targeted question using only the target's vocabulary.

The same rule applies in reverse to `$skill{sourcegraph}` search
queries: search by the symbol the target actually uses, not by your
project's nickname for it. For the full decision tree, see
`$skill{external-research}`.

## When to use

- Understanding architecture or internals of a GitHub dependency
- Researching how an open-source library works before adopting it
- Answering "how does X work in repo Y?" questions
- Comparing two GitHub projects' approaches
- Scanning a repo's structure before diving into source code

## MCP connection

DeepWiki is a **remote** MCP server — no secrets required.

### If `docker-mcp` gateway is available

```
mcp-find({"query": "deepwiki"})
mcp-add({"name": "deepwiki", "activate": false})
mcp-exec({"name": "deepwiki__ask_question", "arguments": {"repoName": "owner/repo", "question": "..."}})
```

### If DeepWiki is a pre-configured MCP server

The agent runtime already has the DeepWiki MCP server registered via the
host's standard MCP setup. Use the runtime's documented tool-dispatch
API to invoke its exposed tools. **Do not** read or parse the MCP
configuration file from the skill — let the runtime route the call.

Concretely, the dispatch shape is:

```
<runtime-call> deepwiki.ask_question(repoName="owner/repo", question="...")
```

Replace `<runtime-call>` with your runtime's documented dispatch
primitive — for example, a typed client method or a generic gateway
invoke. Exact names vary by host; this skill targets the conceptual
flow, not a specific runtime API.

## Tools

| Tool | Key args | Description |
|------|----------|-------------|
| `read_wiki_structure` | `repoName` (`owner/repo`) | List documentation topics for a repo |
| `read_wiki_contents` | `repoName` | Read the full wiki (large; use selectively) |
| `ask_question` | `repoName`, `question` | AI-powered Q&A grounded in the repo's code |

## Workflow — always non-blocking

When DeepWiki analysis is needed, **spawn a background subagent** so the
current thread continues working. Never call DeepWiki tools directly from
the main thread if other work is pending.

### Step 1: Launch background subagent

```
run_subagent(
  title="DeepWiki: <short description>",
  is_background=true,
  profile="subagent_explore",
  task="""
Analyze the GitHub repository <owner/repo> using DeepWiki MCP tools.

## Setup

The exact invocation pattern depends on the host agent runtime. The
following is the conceptual sequence — replace `<runtime-call>` with
your runtime's documented MCP tool-dispatch API.

1. Ask the runtime whether the `deepwiki` server is registered.
   `<runtime-call> list_mcp_servers` — check the result for `"deepwiki"`.
2. If registered, dispatch to its exposed tools.
   `<runtime-call> deepwiki.ask_question(repoName=<owner/repo>, question=<Q>)`
3. If only a Docker-backed MCP gateway is registered, route through it.
   `<runtime-call> gateway.lookup(server="deepwiki")`
   `<runtime-call> gateway.attach(name="deepwiki", activate=false)`
   `<runtime-call> gateway.invoke(server="deepwiki", tool=<tool>, args=<args>)`
4. If neither is registered, report that DeepWiki MCP is not configured.

## Task
<detailed analysis instructions — what to look for, what questions to ask>

## Output
Return a structured summary of findings.
"""
)
```

### Step 2: Continue working

Do other work. The subagent notification arrives automatically when done.

### Step 3: Read results

```
read_subagent(agent_id=<id>, block=false)
```

Incorporate the findings into your response.

## Examples

### Understand a dependency's architecture

```
run_subagent(
  title="DeepWiki: analyze fastify internals",
  is_background=true,
  profile="subagent_explore",
  task="""
Analyze the GitHub repository fastify/fastify using DeepWiki MCP.

Setup: follow the Setup steps in the main deepwiki skill to dispatch the call through the host runtime.

Steps:
1. read_wiki_structure for fastify/fastify to see available topics
2. read_wiki_contents for the full wiki, then locate the plugin system and routing sections
3. ask_question: "How does Fastify's plugin encapsulation work?"

Return: summary of plugin architecture and routing internals.
"""
)
```

### Compare two libraries

```
run_subagent(
  title="DeepWiki: compare express vs fastify",
  is_background=true,
  profile="subagent_explore",
  task="""
Compare expressjs/express and fastify/fastify using DeepWiki MCP.

Setup: follow the Setup steps in the main deepwiki skill to dispatch the call through the host runtime.

Steps:
1. read_wiki_structure for both repos
2. ask_question on each: "What is the request lifecycle and middleware model?"
3. Summarize key architectural differences

Return: comparison table of architecture, performance model, and plugin systems.
"""
)
```

## Limitations

- Only works with **public** GitHub repositories
- DeepWiki generates docs on first request — initial calls may be slower
- Repo name format must be `owner/repo` (e.g., `vercel/next.js`)
