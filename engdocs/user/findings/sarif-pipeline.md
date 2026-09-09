# SARIF pipeline

Sverka provides an end-to-end SARIF pipeline: serialize findings, view them
in a terminal TUI, generate HTML reports, and serve a local web dashboard.

## Overview

```
sverka run --format sarif
       │
       ▼
  .sverka/findings.sarif
       │
       ├──→ sverka view <file>           (terminal TUI)
       ├──→ sverka view <file> -f web    (HTML report)
       ├──→ sverka ui                   (web dashboard)
       └──@sverka/verification           (programmatic API)
```

## Serializing findings

`serializeSarif` converts normalized `Finding[]` to a SARIF 2.1.0 log:

```ts
import { serializeSarif, normalizeSarif } from "@sverka/verification";

// Normalize external SARIF into findings
const findings = normalizeSarif(rawSarif, {
  root: process.cwd(),
  checkIdPrefix: "",
  defaultConfidence: 0.5,
});

// Serialize findings back to SARIF
const sarifLog = serializeSarif(findings);
// sarifLog.version === "2.1.0"
// sarifLog.runs[0].tool.driver.name === "eslint"
// sarifLog.runs[0].results[0].ruleId === "no-unused-vars"
```

The serializer:
- Groups findings by source tool into separate runs
- Deduplicates rules within each run
- Maps Sverka severity to SARIF level (`critical`/`high` → `error`, `medium` → `warning`, etc.)
- Includes fingerprints, locations, and optional snippets

## Running checks with SARIF output

```bash
# Run workflow and produce SARIF
sverka run --format sarif

# Custom output path
sverka run --format sarif -o reports/findings.sarif
```

This runs the workflow, collects findings from all steps, serializes them
to SARIF 2.1.0, and writes to `.sverka/findings.sarif` (or the path you
specify with `-o`).

## Viewing findings

### Terminal TUI

```bash
# View a SARIF file in the terminal
sverka view findings.sarif

# Pipe SARIF via stdin
cat findings.sarif | sverka view
```

The TUI provides:
- Severity filtering (all, critical, high, medium, low, info)
- Text search across message, check ID, file, and rule
- Column sorting (severity, file, rule)
- Detail panel with full finding information
- Keyboard navigation (j/k, /, f, s, d, q)

### HTML report

```bash
# Generate an HTML report
sverka view findings.sarif --format web

# Custom output path
sverka view findings.sarif --format web -o report.html
```

The HTML report is self-contained — inline CSS and JavaScript, no external
dependencies, no CDN. It includes:
- Summary counts (total, critical, high, medium, low, info)
- Tool name from the first finding
- Severity filtering, text search, and column sorting
- XSS-safe rendering (escaped HTML and JSON)

### Web dashboard

```bash
# Start a local web dashboard
sverka ui

# Custom port and host
sverka ui --port 8080 --host 0.0.0.0
```

The dashboard:
- Lists all SARIF files in `.sverka/artifacts/`
- Click any file to view the rendered findings report
- Path traversal protection on report endpoints
- Pure Node.js `http` — no external server dependency

## Running with web output

```bash
# Run workflow and generate HTML report directly
sverka run --format web

# Custom output path
sverka run --format web -o .sverka/report.html
```

This runs the workflow, collects findings, generates a self-contained HTML
report via `@sverka/sarif-viewer-web`, and writes it to disk.

## Programmatic API

### Serialize

```ts
import { serializeSarif, type Finding } from "@sverka/verification";

const sarifLog = serializeSarif(findings);
const json = JSON.stringify(sarifLog, null, 2);
```

### TUI viewer

```ts
import { renderSarifTui } from "@sverka/sarif-viewer-tui";

await renderSarifTui({ sarif: sarifLog });
// or: await renderSarifTui({ findings });
// or: await renderSarifTui({ sarifPath: "findings.sarif" });
```

### HTML generator

```ts
import { generateSarifHtml, renderSarifWeb } from "@sverka/sarif-viewer-web";

// Pure function — no I/O
const html = generateSarifHtml(findings);

// Or write to file
await renderSarifWeb({ findings, outputPath: "report.html" });
```

### Web dashboard server

```ts
import { startUiServer } from "@sverka/ui";

const server = await startUiServer({
  artifactsDir: ".sverka/artifacts",
  port: 3000,
  host: "localhost",
});

console.log(`Dashboard running at ${server.url}`);
// server.close() to stop
```

## Packages

| Package | Purpose |
|---------|---------|
| `@sverka/verification` | `serializeSarif`, `normalizeSarif`, `Finding` types |
| `@sverka/sarif-viewer-tui` | Ink-based terminal TUI |
| `@sverka/sarif-viewer-web` | Self-contained HTML report generator |
| `@sverka/ui` | Local web dashboard server |

All viewer packages are standalone — they do not depend on
`@sverka/runtime`, `@sverka/workflow`, or `@sverka/reporter`.

## Next steps

- [Built-in checks](../reference/checks.md) — check IDs and SARIF extraction
- [Findings normalization](../reference/findings.md) — SARIF normalization details
- [Policy enforcement](../reference/policy.md) — severity rules and gates
