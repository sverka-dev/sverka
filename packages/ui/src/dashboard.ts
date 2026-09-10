// @sverka/ui — dashboard HTML generator.

/** Render the dashboard page listing available SARIF files. */
export function renderDashboard(artifactsDir: string, files: readonly string[]): string {
  const fileList = files.length === 0
    ? '<p class="empty">No SARIF files found. Run <code>sverka run --format sarif</code> to generate findings.</p>'
    : `<ul class="file-list">
      ${files.map((f) => `<li><a href="/report/${encodeURIComponent(f)}">${escapeHtml(f)}</a></li>`).join("\n      ")}
    </ul>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sverka Dashboard</title>
  <style>${CSS}</style>
</head>
<body>
  <header>
    <h1>Sverka Dashboard</h1>
    <p class="path">Artifacts: <code>${escapeHtml(artifactsDir)}</code></p>
  </header>
  <main>
    <h2>SARIF Reports</h2>
    ${fileList}
  </main>
  <footer>
    <a href="https://sverka.dev">sverka.dev</a>
  </footer>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const CSS = String.raw`
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 0;
  background: #0d1117;
  color: #c9d1d9;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  line-height: 1.6;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
header {
  padding: 1.5rem 2rem;
  background: #161b22;
  border-bottom: 1px solid #30363d;
}
header h1 { margin: 0 0 0.5rem 0; font-size: 1.5rem; color: #f0f6fc; }
.path { font-size: 0.875rem; color: #8b949e; margin: 0; }
path code { color: #58a6ff; }
main { flex: 1; padding: 2rem; }
h2 { font-size: 1.25rem; color: #f0f6fc; margin: 0 0 1rem 0; }
.file-list { list-style: none; padding: 0; }
.file-list li { margin-bottom: 0.5rem; }
.file-list a {
  display: block;
  padding: 0.75rem 1rem;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 6px;
  color: #58a6ff;
  text-decoration: none;
  font-family: monospace;
  font-size: 0.9rem;
}
.file-list a:hover { border-color: #58a6ff; background: #1c2330; }
.empty { color: #8b949e; padding: 2rem; text-align: center; }
code { background: #21262d; padding: 0.1rem 0.3rem; border-radius: 3px; }
footer { padding: 1rem 2rem; border-top: 1px solid #21262d; text-align: center; }
footer a { color: #58a6ff; text-decoration: none; }
`;
