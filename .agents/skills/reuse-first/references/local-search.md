# Local Search Recipes

<!-- os-independence-exempt: intentional POSIX bash recipes; on Windows run under Git Bash or WSL -->

Concrete `rg`, `ast-grep`, and `ctags` recipes for the most common code search patterns. Use this reference when running `reuse-first` step 3 (local search).

## Tool priority

1. **ast-grep (`sg`)** — structural AST match, most precise
2. **ctags** — symbol lookup (where is X defined)
3. **ripgrep (`rg`)** — text/regex, universal fallback

Always pick the most precise tool that answers the actual question:

- "Where is function X called?" → start with `rg` (you want call sites, not definitions)
- "What functions match this shape?" → start with `sg`
- "Where is the type `Foo` defined?" → start with `ctags` if indexed, else `rg`

## Universal flags (apply always)

```bash
# .gitignore-aware, exclude build artifacts
rg "..." -g '!{node_modules,.git,dist,build,vendor,.venv,__pycache__,target}/'
sg run -p "..." -g '!{node_modules,.git,dist,build,vendor,target}/'
```

Add project-specific exclusions: `-g '!*.min.js'`, `-g '!coverage/'`, etc.

## TypeScript / JavaScript

### Find all exported functions matching a shape

```bash
sg run -p 'export function $NAME($$$ARGS): $RET { $$$BODY }' -l ts src/
sg run -p 'export async function $NAME($$$ARGS): Promise<$RET> { $$$BODY }' -l ts src/
sg run -p 'export const $NAME = ($$$ARGS): $RET => $$$BODY' -l ts src/
```

### Find all call sites of a function

```bash
rg '\bdebounce\(' -t ts -t js -g '!{node_modules,dist,build}/'
# Shows every call site; combine with the import search below to see who imports it
rg 'import .*debounce|debounce .*from' -t ts -t js -g '!{node_modules,dist,build}/'
```

### Find all classes that implement an interface

```bash
sg run -p 'class $NAME implements $IFACE { $$$BODY }' -l ts src/
```

### Find error handling patterns

```bash
sg run -p 'try { $$$BODY } catch ($E) { $$$HANDLER }' -l ts src/
sg run -p '.catch(($E) => $$$HANDLER)' -l ts src/
```

### Find uses of a deprecated API (audit)

```bash
rg 'moment\(\)|moment\.' -t ts -g '!{node_modules,dist}/'
```

## Python

### Find functions matching a shape

```bash
sg run -p 'def $NAME($$$ARGS) -> $RET:
    $$$BODY' -l py src/

sg run -p 'async def $NAME($$$ARGS) -> $RET:
    $$$BODY' -l py src/
```

### Find decorated functions

```bash
sg run -p '@$DEC
def $NAME($$$ARGS): $$$BODY' -l py src/
```

### Find subclasses

```bash
sg run -p 'class $NAME($BASE):
    $$$BODY' -l py src/
```

### See how an import is used

```bash
rg '^(from numpy import|import numpy)' -t py
rg '\bnp\.' -t py | head -20
```

## Go

### Find function shapes

```bash
sg run -p 'func $NAME($$$ARGS) ($RET, error) { $$$BODY }' -l go .
sg run -p 'func (r *$RECV) $NAME($$$ARGS) $RET { $$$BODY }' -l go .
```

### Find goroutine spawns

```bash
sg run -p 'go $FUNC($$$ARGS)' -l go .
```

### Find all uses of a stdlib package

```bash
rg '"context"' -t go | head -20
# Then check whether context is being threaded correctly
```

## Rust

### Find function shapes

```bash
sg run -p 'pub fn $NAME($$$ARGS) -> $RET { $$$BODY }' -l rs src/
sg run -p 'pub async fn $NAME($$$ARGS) -> Result<$RET, $ERR> { $$$BODY }' -l rs src/
```

### Find trait impls

```bash
sg run -p 'impl $TRAIT for $TYPE { $$$BODY }' -l rs src/
```

### Find unsafe blocks (audit / migration prep)

```bash
sg run -p 'unsafe { $$$BODY }' -l rs src/
```

## Symbol lookup (where is X defined?)

If a ctags index exists:

```bash
ctags -R .              # build the index (one-time)
rg '^function_name\b' tags | head -5
```

Without ctags, use `rg` with a shape-aware regex:

```bash
# TypeScript / JavaScript
rg '^(export )?(async )?function (name)\b|^const (name)\s*=' -t ts -t js

# Python
rg '^(async )?def (name)\(' -t py

# Go
rg '^func (.*\s)?(name)\(' -t go

# Rust
rg '^(pub )?(async )?fn (name)\b' -t rs
```

## Common gotchas

1. **`$$$` is multi-node, `$` is single.** `$$$ARGS` matches "any number of args", `$ARG` matches "one arg". Mixing them up gives zero results.
2. **sg needs the right language flag.** `-l ts` works; so does `-l typescript`. Check `sg run --help` for the full list per installed version.
3. **rg excludes by .gitignore by default.** For monorepos with nested .gitignores, add `-uu` to ignore all of them.
4. **Hidden files.** rg skips dotfiles by default. Use `-uu` or `-u` to include.
5. **Symlinks.** rg does not follow symlinks by default. Use `-L` to follow.
6. **Generated code.** Add `-g '!*.gen.*'`, `-g '!_generated/'` for projects that ship generated sources.

## Worked example

**Task:** find an existing debounce utility before writing one.

```bash
# Step 1: text search — does "debounce" appear anywhere?
rg 'debounce' -t ts -t js -g '!{node_modules,dist,build}/'
# → 4 hits in src/utils/, 1 in src/hooks/, none in tests

# Step 2: read the candidates
rg -l 'debounce' -t ts -t js
# → src/utils/timing.ts, src/hooks/useDebouncedValue.ts, src/utils/eventHelpers.ts

# Step 3: check shapes
sg run -p 'export function debounce($$$ARGS): $RET { $$$BODY }' -l ts src/
# → src/utils/timing.ts: function debounce<T>(fn: T, ms: number): T with cancellation

# Step 4: check the actual implementation
cat src/utils/timing.ts | head -60
# It does everything I need and is exported.

# Decision: 100% coverage → reuse.
```

If step 3 had returned nothing, the next step is OSS search (`oss-search.md`).
