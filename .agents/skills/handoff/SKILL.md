---
name: handoff
description: Write a handoff document so a fresh agent session can continue the work on the same machine and user account, or resume the most recent handoff across git worktrees on that machine. Use when a thread is full, crossing a context-window boundary, returning after `/clear`, or branching into a parallel session. Distinct from the built-in `/compact`.
---

# Handoff

Write or resume a handoff document so a fresh agent on the same machine and user
account can continue the work.

- `/handoff <topic>` writes a new handoff.
- `/handoff resume` auto-loads the newest valid handoff when exactly one valid
  candidate exists, lists the candidates and prompts the user when multiple
  valid candidates exist, and reports that none exist when no valid candidate is
  found.

## Why a separate file (not in-repo)

- The handoff body lives in the OS temp directory to stay portable across
checkouts and out of git.
- A per-worktree `.agents/handoffs/latest.md` pointer survives `/clear` and lets
a fresh session find the handoff from the repository root without searching the
temp directory.
- The handoff is **throwaway by nature** — once the next session is up to speed,
the file has done its job. Keeping it out of the repo prevents accidental
commits of working notes.
- Handoffs are scoped to the **same machine and user account** that wrote them.
An OS temp path and a per-worktree pointer are not available on a different
machine. For cross-machine continuation, copy the handoff file to a shared
artifact store (S3, an internal file share, etc.) and pass a reference, or use
`$skill{handoff}` for durable cross-work preservation.

## Creating a handoff

1. Record the current git context:
   - `working_dir` — absolute path of the current worktree or repo root.
   - `branch` — output of `git branch --show-current` (or `git rev-parse
     --abbrev-ref HEAD`).
   - `commit` — optional short SHA for verification.
   - `topic` — sanitized topic slug derived from the handoff filename (see the
     Naming rule below).
   - `linked_plans` — paths to any plans, specs, or ADRs tied to the current
     work. Use an empty list when there are none.
   - `created_at` — current UTC timestamp in RFC 3339 format with an explicit
     `Z` offset (for example `2026-07-25T19:18:00Z`). Do not use a local or
     timezone-less value.
2. Write the handoff body to the OS temp directory using the naming rule below.
   Keep the absolute path.
3. Create `<current-worktree>/.agents/handoffs/` if it does not exist, then
   atomically create or update `<current-worktree>/.agents/handoffs/latest.md`
   with this YAML frontmatter:

```yaml
---
handoff: "<os-temp-dir>/handoff-2026-07-25-191800-topic-a1b28f2d.md"
working_dir: "<worktree-path>"
branch: feature/handoff
commit: a1b2c3d
topic: topic
created_at: "2026-07-25T19:18:00Z"
linked_plans:
  - "docs/plans/123-foo.md"
---
```

Generate the frontmatter with a YAML serializer. Create the temporary pointer
file in the same directory with owner-only access (mode `0600` on POSIX or a
current-user-only ACL on Windows), for example `latest.md.<nonce>.tmp`, write the
frontmatter to it, then rename it over `latest.md` so readers never see a
partially written pointer. Before replacing an existing `latest.md`, re-read it
under a cross-platform lock (for example an exclusive `mkdir` of
`latest.md.lock` or an `O_CREAT|O_EXCL` lock file) and only overwrite if the
candidate `created_at` is newer; when timestamps are equal, use fractional seconds
or a monotonic nonce as a tie-breaker so a delayed older writer cannot replace a
newer pointer. To recover from a stale lock if the agent crashes while holding
it, write the agent's PID and process-start identity (for example a process
creation timestamp or start time) inside the lock directory/file and, before
failing on `EEXIST`, verify the recorded holder is still alive (`kill(pid, 0)` on
POSIX, `tasklist` filtered by the recorded start time on Windows). Only reclaim
the lock if the holder process is confirmed gone; do not rely solely on lock
age, because a paused-but-alive writer can still be valid. Use the agent's file
tools or a cross-platform script; do not invoke `mv` or `move` unless the platform
is known.

4. Ensure `.agents/handoffs/` is ignored by git. Append `.agents/handoffs/`
   to `.gitignore`, creating that file if it does not exist; if the rule is
   already present, do nothing. If you cannot create a `.gitignore` (for
   example in a read-only or linked worktree), resolve the exclude file with
   `git rev-parse --git-path info/exclude` and write the rule there.
5. Report both the handoff body path and the `latest.md` path to the user.

## Resume workflow

When the argument is `resume` or the user asks to resume a handoff:

1. Find all candidate worktrees. Run `git rev-parse --show-toplevel` from the
   current directory, then `git worktree list --porcelain` and collect every
   `worktree` path, including the main checkout. If not inside a git repo, fall
   back to the current working directory only.
2. For each candidate worktree, read `<worktree>/.agents/handoffs/latest.md` if
   it exists and parse its frontmatter.
3. Validate each candidate. Reject a candidate if any of the following fail:
   - The `handoff` field is a quoted absolute path that points to a regular file
     in the OS temp directory. Resolve the path, follow no symlinks, and reject
     paths that escape the temp directory, point to a directory or device, or
     do not match the filename pattern `handoff-*.md`. Parse the filename to
     extract the timestamp and topic slug, and cross-check them against
     `created_at` and `topic`. Compare the filename timestamp to the whole-second
     UTC component of `created_at`; fractions, if present, may be used for
     ordering but are not required in the filename. Reject the candidate if either
     component is missing or mismatched.
   - `working_dir` is an absolute path that exists and is a directory; when
     canonicalized it must match the worktree path where this `latest.md` was
     found.
   - `branch` is non-empty and matches the current branch of that worktree
     (`git branch --show-current` run in that worktree).
   - `commit` is either absent or a lowercase hex object ID that resolves to
     a commit (`git cat-file -e <commit>^{commit}` run in that worktree).
   - `created_at` is an RFC 3339 timestamp with an explicit UTC offset or `Z`.
     Normalize accepted timestamps to UTC before sorting.
   - `topic` is present and sanitized (kebab-case, `[a-z0-9-]`, max 32 chars).
     If it is absent, derive it from the `handoff` filename slug.
   - `linked_plans` is present and is a list of strings (empty is valid). Resolve
     relative paths against the candidate's `working_dir` in the originating
     worktree, then note which listed files are still present.
4. Sort valid candidates by `created_at` descending (newest first).
5. If no valid candidate exists, tell the user and stop.
6. If exactly one valid candidate remains, load its `handoff` file. If
   `working_dir` differs from the current working directory, warn the user and
   ask whether to switch to that directory before continuing.
7. If multiple candidates remain, list them with `topic`, `working_dir`,
   `branch`, `created_at`, and ask the user to choose. Do not silently select
   the root checkout's `latest.md` just because the session started there.

## Naming rule

Use a unique, sortable filename so the next session can list and pick a handoff
without ambiguity. The recommended pattern is
`handoff-<YYYY-MM-DD-HHMMSS>-<short-topic-slug>-<collision-suffix>.md`
(for example `handoff-2026-07-23-143012-import-mattpocock-skills-7f3ac91d.md`);
substitute `<short-topic-slug>` with a **kebab-case, length-limited,
allowlisted** topic phrase (see Sanitisation below), use the **current UTC
timestamp with second precision** (do not infer from memory), and append a
short collision-resistant suffix (a 4-hex-char digest of the timestamp + topic
plus a 4-hex-char random nonce is enough — see the retry note below) so two
sessions writing in the same second do not collide. Create the file with
**exclusive-create** semantics (`O_CREAT|O_EXCL` in C, `open(path, 'x')` in
Python, `fs.openSync(path, 'wx')` in Node) and on collision **retry with a
freshly drawn random nonce** in the suffix (not the same digest) before
reporting failure — a fixed digest would deterministically collide again, so
each retry must pull from a fresh source of entropy (for example
`os.urandom(2).hex()` in Python or `crypto.randomBytes(2).toString('hex')` in
Node). Bound the retry to a small number (3 attempts) so a pathological
collision does not loop. Create the file with owner-only permissions from the
start: use mode `0o600` (`os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)`
wrapped with `os.fdopen(fd, 'w')` in Python, `fs.openSync(path, 'wx', 0o600)` in Node)
and a current-user-only ACL on Windows.
`O_EXCL` prevents overwrite races; setting the permission at creation prevents
a permissive umask from exposing the file to other users on shared hosts. The session
that **writes** the handoff must **report its absolute path** back to the user
(in the same response) so the user can pass it to the next session by reference
rather than searching the temp directory.

## Sanitisation

The topic slug becomes part of a path the user sees in chat, in logs, and in
shell history. Build it from an **allowlist** of `[a-z0-9-]`, length-limit it
(32 chars is plenty), and **never** substitute raw user input, URL components,
or branch names into the slug without scrubbing. A reasonable default is to
derive the slug from a short summary the user already typed. Redact the raw
summary first (API keys, hostnames, PII, etc.), then allowlist and length-limit
it, then fall back to `untitled` if the sanitised form is empty. **Do not**
rely solely on the document-content redaction step below — the filename can leak
secrets even when the body is redacted.

Include a "suggested skills" section in the document, which suggests skills the
next agent should reach for given the work's shape.

Do not duplicate content already captured in other artifacts (specs, plans,
ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information — API keys, passwords, personally identifiable
information, internal hostnames.

If the user passed arguments, treat them as a description of what the next
session will focus on and tailor the doc accordingly. If the argument is
`resume`, run the resume workflow instead of creating a new handoff.

## Anatomy of a good handoff

A handoff that the next agent can pick up cold usually has:

1. **One-paragraph summary** — what we were doing, where we stopped, what the
   open question is.
2. **State of the world** — files changed, branches in flight, worktrees open,
   CI status, open PRs, and the absolute `working_dir` where the handoff was
   created.
3. **Decisions made** — with a one-line rationale each. Link to ADRs / specs /
   issues when they exist; never restate their content.
4. **Open questions / next actions** — what the next session should do first.
5. **Suggested skills** — short list of skills the next session should consult
   (for example `$shared-plan` if work spans agents, `$evidence` if a claim must
   be proven, `$skill{review-methodology}` before a merge).
6. **Constraints** — secrets locations (redacted), tool versions, environment
   quirks the next session will trip over otherwise, and that the handoff is
   scoped to the same machine and user account.

## Related skills

- `$skill{handoff}` — durable cross-work preservation; lives inside the
  workspace, not in OS temp.
- `$skill{shared-plan}` — when the next session is one of many agents continuing
  a long plan.
- `$skill{unwind}` — collapse a solved subtask into the parent plan instead of
  forking a new session.
