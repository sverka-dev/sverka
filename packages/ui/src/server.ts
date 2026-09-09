// @sverka/ui — local web dashboard server.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
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

/**
 * Start a local web dashboard server that lists SARIF files and
 * renders individual findings reports. Returns when the server is
 * listening.
 */
export function startUiServer(options: UiServerOptions): Promise<UiServer> {
  const port = options.port ?? 3000;
  const host = options.host ?? "localhost";
  const artifactsDir = options.artifactsDir;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handleRequest(req, res, artifactsDir);
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      resolve({
        port,
        url: `http://${host}:${port}`,
        close: () => server.close(),
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
    const filename = decodeURIComponent(url.slice("/report/".length));
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
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
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
  if (!existsSync(filePath)) {
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
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(`Error rendering report: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** List .sarif and .sarif.json files in the artifacts directory. */
function listSarifFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => {
      const ext = extname(f);
      return f.endsWith(".sarif") || f.endsWith(".sarif.json");
    })
    .sort();
}
