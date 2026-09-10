// @sverka/ui — local web dashboard server.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readdirSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { join, extname, resolve, sep } from "node:path";
import { normalizeSarif, type Finding, type SarifLog } from "@sverka/verification";
import { generateSarifHtml } from "@sverka/sarif-viewer-web";
import { renderDashboard } from "./dashboard.js";

export interface UiServerOptions {
  /** Directory to scan for SARIF files (default: .sverka/artifacts). */
  readonly artifactsDir: string;
  /** Port to listen on (default: 3000). */
  readonly port?: number;
  /** Host to bind (default: localhost). */
  readonly host?: string;
}

export interface UiServer {
  readonly port: number;
  readonly url: string;
  close(): void;
}

/** Security headers for all HTML responses — defense-in-depth against XSS.
 * The CSP blocks inline scripts (script-src 'none') even if escaping fails.
 * generateSarifHtml escapes all user-controlled data via escapeHtml(). */
const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'",
  "x-content-type-options": "nosniff",
} as const;

/**
 * Start a local web dashboard server that lists SARIF files and
 * renders individual findings reports. Returns when the server is
 * listening.
 */
export function startUiServer(options: UiServerOptions): Promise<UiServer> {
  const port = options.port ?? 3000;
  const host = options.host ?? "localhost";
  const artifactsDir = resolve(options.artifactsDir);

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handleRequest(req, res, artifactsDir);
  });

  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.on("error", onError);

    server.listen(port, host, () => {
      // Get the actual port (supports port 0 = ephemeral).
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;

      // Keep the error listener active for errors after listen (e.g. ECONNRESET).
      server.removeListener("error", onError);
      server.on("error", () => {
        // Swallow post-listen errors — the server is already running.
      });

      resolve({
        port: actualPort,
        url: `http://${host}:${actualPort}`,
        close: () => {
          server.close((err) => {
            if (err && err.code !== "ERR_SERVER_NOT_RUNNING") {
              // Ignore — server may already be closed.
            }
          });
        },
      });
    });
  });
}

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  artifactsDir: string,
): void {
  const url = req.url ?? "/";

  if (url === "/" || url === "/dashboard") {
    serveDashboard(res, artifactsDir);
    return;
  }

  if (url.startsWith("/report/")) {
    let filename: string;
    try {
      filename = decodeURIComponent(url.slice("/report/".length));
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("Invalid URL encoding");
      return;
    }
    serveReport(res, artifactsDir, filename);
    return;
  }

  if (url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
}

/** List SARIF files and render the dashboard page. */
function serveDashboard(
  res: ServerResponse,
  artifactsDir: string,
): void {
  const files = listSarifFiles(artifactsDir);
  const html = renderDashboard(artifactsDir, files);
  res.writeHead(200, HTML_HEADERS);
  res.end(html);
}

/** Read a SARIF file, normalize findings, and render the HTML report. */
function serveReport(
  res: ServerResponse,
  artifactsDir: string,
  filename: string,
): void {
  // Validate filename — prevent path traversal.
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("Invalid filename");
    return;
  }

  const filePath = join(artifactsDir, filename);

  // Resolve real paths and verify the file is inside artifactsDir.
  // This also prevents symlink-based escapes.
  try {
    const realArtifacts = realpathSync(artifactsDir);
    const realFile = realpathSync(filePath);
    if (!realFile.startsWith(realArtifacts + sep) && realFile !== realArtifacts) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("Invalid filename");
      return;
    }
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("File not found");
    return;
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const sarif = JSON.parse(raw) as SarifLog;
    const findings = normalizeSarif(sarif, {
      root: artifactsDir,
      checkIdPrefix: "",
      defaultConfidence: 0.5,
    });
    const html = generateSarifHtml(findings);
    res.writeHead(200, HTML_HEADERS);
    res.end(html);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(`Error rendering report: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** List .sarif and .sarif.json files in the artifacts directory. */
function listSarifFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => {
        const ext = extname(f);
        return f.endsWith(".sarif") || f.endsWith(".sarif.json");
      })
      .sort();
  } catch {
    return [];
  }
}
