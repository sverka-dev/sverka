# Greenfield Project Handling

<!-- os-independence-exempt: intentional POSIX bash recipes; on Windows run under Git Bash or WSL -->

When the project is small or brand new, the local-search step is wasted effort. Use this reference to recognize and handle the greenfield case.

## Detection

Run the size detection from the SKILL.md procedure:

```bash
file_count=$(find . -type f \( -name '*.ts' -o -name '*.py' -o -name '*.go' -o -name '*.rs' -o -name '*.java' \) \
  -not -path './node_modules/*' -not -path './.git/*' -not -path './dist/*' -not -path './build/*' | wc -l)
```

If `file_count < 20` (rule of thumb; tune for your project), skip local search.

A more refined heuristic: also skip if the project has no `src/`, `lib/`, `pkg/`, `internal/`, or `app/` directory — that means the structure is not yet conventional, and what is there is likely a scaffold (vite create, cargo new, etc.) where reuse does not apply yet.

## What changes in greenfield mode

- **Skip step 3 (local search)** entirely — there is no local corpus
- **Higher bar for new code** — there are no existing patterns to copy, so each new file is a "first instance" that future code will mimic. Get them right.
- **OSS search is the only path** — go directly to step 4
- **Document the absence** — note in the decision: "Greenfield project, no local candidates possible. OSS search performed." This is the negative evidence.

## Higher bar for new code in greenfield

Without local patterns, your new code becomes the pattern. So:

- **Match the boring stack.** If you're on Next.js, write Next.js conventions. If on Rails, write Rails conventions. The "obvious" choice is the right one — not the clever one.
- **Use the framework's idioms first.** React hook for state, not a hand-rolled store. Django ORM, not raw SQL. The framework's choice is right until proven wrong.
- **One file per concern.** No "utils.ts" with 47 functions in a 5-file project. Each util gets its own file or lives in the file that uses it.
- **No premature abstractions.** Three similar call sites are not a pattern. Ten are. Wait for ten.

## Templating for common shapes

In a greenfield project, the right answer is often "use what `<boring stack>` uses". Concretely:

| Domain | "Boring" reference project | What to copy |
|---|---|---|
| React + Vite app | `vitejs/vite` examples, `vercel/next.js` examples | Component file structure, hooks placement |
| Express REST API | `expressjs/express` examples | Middleware order, error handler shape |
| Python CLI | `tiangolo/typer` examples | Argument parsing, command grouping |
| Go service | `spf13/cobra` examples | Command structure, config loading |
| Rust CLI | `clap-rs/clap` examples | Subcommand pattern, arg validation |

When in doubt: find the official quickstart for the framework and follow it. Don't invent.

## Worked example

**Task:** new Next.js app, need a "loading spinner" component.

```bash
# Step 1: detect
file_count=8  # just the Next.js scaffold
# → greenfield, skip local search

# Step 2: go straight to OSS
gh search code "loading spinner react component" --language typescript --limit 5
# → react-spinners, react-loader-spinner, plus dozens of single-file components

# Step 3: consider
# Option A: pull react-spinners (40KB, 12 components, way more than needed)
# Option B: write 15 lines of Tailwind + CSS animation inline
#
# Decision: write the 15 lines. It's not a "library" problem yet.
# If the project grows and we have 3 spinners, then revisit.
```

The principle: greenfield = high cost of every dep, because each one becomes permanent. Wait for evidence that the cost is justified.

## When greenfield stops being greenfield

Roughly 50 files, or the first major refactor, or the first time you say "we already wrote something like this" — at that point, switch back to full local-search mode. The transition is natural; you don't need to announce it.
