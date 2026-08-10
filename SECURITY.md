# Security Policy

## Reporting Vulnerabilities

Report security vulnerabilities privately. Do NOT open a public GitHub issue.

- Email: security@sverka.dev
- Response time: 48 hours
- Disclosure: coordinated, after fix is released

## Secrets

- NEVER commit secrets, API keys, tokens, or passwords to the repository
- Use environment variables or secret managers
- If a secret is accidentally committed: rotate it immediately, then force-push
  the branch to remove it from history
- Reviewer must check for hardcoded secrets in every PR

## Dependencies

- Prefer dependencies published at least 7 days ago (supply chain safety)
- Avoid floating ranges (`latest`, `*`, unbounded `>=`) that auto-resolve to
  brand-new releases
- Run `bun audit` periodically
- Pin lockfile (`bun.lock`) — do not commit without it

## Code Security

- No `any` types (use `unknown` and narrow) — prevents type confusion bugs
- Validate all external input before use
- No `eval()`, no `new Function()`, no dynamic code execution
- No `child_process.exec` with user input — use `execFile` with arg arrays
- Sanitize file paths — no path traversal via `..` in user input
- Use `spawnSync` with timeout for subprocess calls (prevent hangs)

## CI/CD Security

- Never modify repository security policies or compliance controls to work
  around CI failures
- Never disable branch protection, even temporarily
- Escalate CI/auth failures to the user instead of working around them

## Agent Security

- Agents must not expose or log secrets
- Agents must not commit secrets
- Agents must not modify security policies
- `dangerous` permission mode is for local dev only, never for CI

## Runtime Security

Sverka executes commands in Docker containers and host processes:

- Docker executor: verify image digests, no untrusted images
- Host executor: validate commands before execution, no shell injection
- Runtime args: sanitize all user-provided paths and arguments
- Credentials: pass via env vars, never log them
