---
pipeline: docs
extends: ./agent.mjs
---

# GitLab agentic workflows

Discovery entry point for `sverka` — `findConfig` resolves the first
`.sverka/*.md` file when no `sverka.config.ts` exists. The agent
pipeline itself lives in `./agent.mjs` (`extends:`): agent steps,
`permissions.write`, and schedules are authored in TypeScript because
the markdown subset is shell-steps only. See `../README.md` for the
webhook/schedule/token setup.
