# Spec 42: Benchmark Dashboard

## Purpose

Static HTML dashboard that loads benchmark results JSON and renders a
left/right comparison table of raw-shell vs sverka agent metrics with delta
columns. Deployed at sverka.dev/benchmark.

## Interface

### Files

```
website/public/benchmark/
  index.html         — dashboard page (vanilla JS, no framework)
  sample-result.json — sample BenchmarkResult for demo/preview
```

### Dashboard Behavior

1. On load, fetch `sample-result.json` (or `?data=<url>` query param for
   custom results)
2. Render comparison table: one row per task, columns for each metric
3. Left side: raw-shell agent metrics
4. Right side: sverka agent metrics
5. Delta column: difference (sverka - raw-shell), green if sverka better
   (fewer tokens/tools/time), red if worse
6. Summary section: aggregate averages for both agents
7. Model + timestamp header

### Metrics Displayed

| Metric | Display |
|--------|---------|
| Input tokens | number |
| Output tokens | number |
| Total tokens | number |
| Tool calls | number |
| Execution time | ms → seconds (1 decimal) |
| Success | checkmark / cross |

### Styling

- Dark theme matching sverka.dev
- Responsive (works on mobile)
- No external CSS/JS dependencies — all inline
- Monospace font for numbers

## Test Plan

1. index.html exists and is valid HTML
2. sample-result.json is valid BenchmarkResult JSON
3. Dashboard renders comparison table from sample data (JS DOM test)
4. Delta calculation: correctly computes sverka - raw-shell per metric
5. Green/red coloring: fewer tokens = green (sverka wins), more = red
6. Summary section shows aggregate averages
7. Custom data URL: `?data=<url>` loads external JSON

## Dependencies

None — vanilla HTML/CSS/JS, no build step.

## Non-goals

- Charts (table is sufficient for MVP)
- Real-time updates (static page)
- Server-side rendering
- npm package (static files in website/public/)
