// Shared HTML escaping + page shell for server-rendered pages.

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Shared dark theme — same palette as the SARIF dashboard. */
export const PAGE_CSS = String.raw`
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
header nav { font-size: 0.875rem; }
header nav a { color: #58a6ff; text-decoration: none; margin-right: 1rem; }
header nav a:hover { text-decoration: underline; }
.path { font-size: 0.875rem; color: #8b949e; margin: 0; }
main { flex: 1; padding: 2rem; }
h2 { font-size: 1.25rem; color: #f0f6fc; margin: 0 0 1rem 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #21262d; }
th { color: #8b949e; font-weight: 600; }
tr:hover td { background: #161b22; }
a { color: #58a6ff; text-decoration: none; }
a:hover { text-decoration: underline; }
code { background: #21262d; padding: 0.1rem 0.3rem; border-radius: 3px; }
.empty { color: #8b949e; padding: 2rem; text-align: center; }
.ok { color: #3fb950; }
.fail { color: #f85149; }
.warn { color: #d29922; }
.muted { color: #8b949e; }
footer { padding: 1rem 2rem; border-top: 1px solid #21262d; text-align: center; }
footer a { color: #58a6ff; text-decoration: none; }
iframe.findings {
  width: 100%;
  min-height: 32rem;
  border: 1px solid #30363d;
  border-radius: 6px;
  background: #fff;
}
`;

/** Wrap page body in the shared shell (doctype, head, header, footer). */
export function pageShell(opts: {
  title: string;
  subtitle?: string;
  nav?: readonly { href: string; label: string }[];
  body: string;
}): string {
  const nav = (opts.nav ?? [])
    .map((n) => `<a href="${escapeHtml(n.href)}">${escapeHtml(n.label)}</a>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(opts.title)}</title>
  <style>${PAGE_CSS}</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(opts.title)}</h1>
    ${opts.subtitle !== undefined ? `<p class="path">${opts.subtitle}</p>` : ""}
    ${nav === "" ? "" : `<nav>${nav}</nav>`}
  </header>
  <main>
    ${opts.body}
  </main>
  <footer>
    <a href="https://sverka.dev">sverka.dev</a>
  </footer>
</body>
</html>`;
}
