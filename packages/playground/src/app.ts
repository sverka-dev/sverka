// @sverka/playground — web app entry point.
// Loads Monaco editor, evaluates user pipeline code, runs checks, shows findings.

import {
  encodeShareLink,
  decodeShareLink,
  PlaygroundError,
  SHARE_PAYLOAD_WARN_BYTES,
} from "./index.js";
import type { Finding } from "./index.js";
import { generateSarifHtml } from "@sverka/sarif-viewer-web/html-generator";
import {
  DEFAULT_CODE,
  escapeHtml,
  evaluateUserCode,
  runPipelineWithTimeout,
} from "./engine.js";

const SHARE_PREFIX_LEN = "#c=".length;

/** Show findings HTML in the iframe. */
function showFindings(html: string): void {
  const frame = document.getElementById(
    "findings-frame",
  ) as HTMLIFrameElement | null;
  if (!frame) return;
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
}

/** Show an error message in the findings panel. */
function showError(message: string): void {
  const html = `<!DOCTYPE html>
<html><head><style>
  body { background: #0d1117; color: #f85149; font-family: monospace; padding: 2rem; }
  h2 { color: #f85149; }
  pre { color: #c9d1d9; white-space: pre-wrap; }
</style></head><body>
  <h2>Error</h2>
  <pre>${escapeHtml(message)}</pre>
</body></html>`;
  showFindings(html);
}

/** Set the status indicator. */
function setStatus(text: string, cls: string): void {
  const status = document.getElementById("status");
  if (!status) return;
  status.textContent = text;
  status.className = `status ${cls}`;
}

/** Load Monaco editor from CDN. */
async function loadMonaco(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.min.js";
    script.crossOrigin = "anonymous";
    script.integrity =
      "sha384-tVClT0hDec4bpcWvHS/0jUInFR35FJlNXnR9k8H+Vj98DpbnGT3z81pNCQOM4bWo";
    script.onload = () => {
      // Monaco loader is available as global require
      const monacoRequire = (
        window as unknown as {
          require: (cfg: unknown, cb: (m: unknown) => void) => void;
        }
      ).require;
      monacoRequire(
        {
          paths: {
            vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs",
          },
        },
        () => {
          resolve();
        },
      );
    };
    script.onerror = () => reject(new Error("Failed to load Monaco editor"));
    document.head.appendChild(script);
  });
}

/** Main entry point. */
async function main(): Promise<void> {
  // Load Monaco
  try {
    await loadMonaco();
  } catch (e) {
    // Fallback: use a textarea
    console.warn("Monaco failed to load, using textarea fallback");
  }

  const monaco = (
    window as unknown as {
      monaco?: {
        editor: {
          create: (
            el: HTMLElement,
            opts: unknown,
          ) => { getValue: () => string; setValue: (v: string) => void };
        };
      };
    }
  ).monaco;

  let getCode: () => string;
  let setCode: (code: string) => void;

  const editorEl = document.getElementById("editor") as HTMLDivElement | null;
  if (!editorEl) {
    console.error("Editor element not found");
    return;
  }

  if (monaco) {
    const editor = monaco.editor.create(editorEl, {
      value: DEFAULT_CODE,
      language: "typescript",
      theme: "vs-dark",
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
    });
    getCode = () => editor.getValue();
    setCode = (code) => editor.setValue(code);
  } else {
    // Textarea fallback
    const textarea = document.createElement("textarea");
    textarea.value = DEFAULT_CODE;
    textarea.style.cssText =
      "width:100%;height:100%;background:#0d1117;color:#c9d1d9;border:none;font-family:monospace;font-size:13px;padding:1rem;resize:none;outline:none;";
    editorEl.appendChild(textarea);
    getCode = () => textarea.value;
    setCode = (code) => {
      textarea.value = code;
    };
  }

  // Run button
  const runBtn = document.getElementById("run-btn") as HTMLButtonElement | null;
  if (!runBtn) {
    console.error("Run button not found");
    return;
  }

  // Findings are shareable only when they came from the code currently in
  // the editor — `lastRunCode` pins the pair so edits/failed runs can't
  // ship stale results next to new source.
  let lastFindings: readonly Finding[] | undefined;
  let lastRunCode: string | undefined;
  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    setStatus("Running...", "running");

    try {
      const code = getCode();
      const project = evaluateUserCode(code);
      const result = await runPipelineWithTimeout(project, 30_000);
      lastFindings = result.findings;
      lastRunCode = code;

      if (result.findings.length === 0) {
        showFindings(
          `<!DOCTYPE html><html><head><style>body{background:#0d1117;color:#3fb950;font-family:monospace;padding:2rem;}</style></head><body><h2>No findings — all checks passed</h2><p>${result.steps.length} steps completed in ${result.totalDurationMs}ms</p></body></html>`,
        );
      } else {
        const html = generateSarifHtml(result.findings);
        showFindings(html);
      }

      setStatus(
        `${result.findings.length} findings · ${result.totalDurationMs}ms`,
        result.success ? "success" : "failure",
      );
    } catch (e) {
      lastFindings = undefined;
      lastRunCode = undefined;
      const msg = e instanceof Error ? e.message : String(e);
      showError(msg);
      setStatus("Error", "failure");
    } finally {
      runBtn.disabled = false;
    }
  });

  // Splitter drag
  const splitter = document.getElementById("splitter") as HTMLDivElement | null;
  const editorPanel = document.querySelector(
    ".editor-panel",
  ) as HTMLElement | null;
  const findingsPanel = document.querySelector(
    ".findings-panel",
  ) as HTMLElement | null;

  if (splitter && editorPanel && findingsPanel) {
    let dragging = false;
    splitter.addEventListener("mousedown", (e) => {
      dragging = true;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const container = document.querySelector(".main") as HTMLElement | null;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const editorWidth = e.clientX - rect.left;
      const findingsWidth = rect.width - editorWidth - 4;
      if (editorWidth > 100 && findingsWidth > 100) {
        editorPanel.style.flex = `${editorWidth}`;
        findingsPanel.style.flex = `${findingsWidth}`;
      }
    });
    document.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  // Share button — serialize code + last findings into a #c= fragment link.
  const shareBtn = document.getElementById(
    "share-btn",
  ) as HTMLButtonElement | null;
  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      const base = `${location.origin}${location.pathname}`;
      const code = getCode();
      const run = {
        schema: "sverka.playground/v1" as const,
        code,
        ...(lastFindings !== undefined && lastRunCode === code
          ? { findings: lastFindings }
          : {}),
      };
      const url = encodeShareLink(run, base);
      history.replaceState(null, "", url);
      // Payload size excludes the "#c=" marker — measure the fragment tail.
      const oversized =
        url.length - base.length - SHARE_PREFIX_LEN > SHARE_PAYLOAD_WARN_BYTES;
      try {
        await navigator.clipboard.writeText(url);
        setStatus(
          oversized
            ? "Link copied — payload exceeds 32 KB, recipients may not load it"
            : "Share link copied",
          oversized ? "failure" : "success",
        );
      } catch {
        setStatus(
          oversized
            ? "Link in address bar — payload exceeds 32 KB, recipients may not load it"
            : "Link in address bar",
          oversized ? "failure" : "success",
        );
      }
    });
  }

  // Share link restore (Spec 53): #c= fragments restore editor state and the
  // last run result. A corrupt link falls back to the default template with a
  // warning — never a blank page.
  //
  // SECURITY: code from a link never auto-runs — executing shared code on
  // page load would let a URL execute arbitrary script in the page context.
  // Seeded findings render directly (validated at decode); code-only links
  // wait for an explicit Run click.
  let restored = false;
  if (location.hash.startsWith("#c=")) {
    try {
      const shared = decodeShareLink(location.hash);
      setCode(shared.code);
      restored = true;
      if (shared.findings !== undefined) {
        lastFindings = shared.findings;
        lastRunCode = shared.code;
        if (shared.findings.length === 0) {
          showFindings(
            `<!DOCTYPE html><html><head><style>body{background:#0d1117;color:#3fb950;font-family:monospace;padding:2rem;}</style></head><body><h2>No findings — all checks passed</h2><p>Restored from a shared run</p></body></html>`,
          );
        } else {
          showFindings(generateSarifHtml(shared.findings));
        }
        setStatus("Restored shared run", "success");
      } else {
        setStatus("Shared code loaded — press Run", "success");
      }
    } catch (e) {
      // Mark restored so the warning isn't overwritten by the auto-run.
      restored = true;
      const msg = e instanceof PlaygroundError ? e.message : String(e);
      showFindings(
        `<!DOCTYPE html><html><head><style>body{background:#0d1117;color:#d29922;font-family:monospace;padding:2rem;}</style></head><body><h2>Share link could not be loaded</h2><p>${escapeHtml(msg)}</p><p>Loaded the default template instead.</p></body></html>`,
      );
      setStatus("Share link invalid — default loaded", "failure");
    }
  }

  // Auto-run on load unless a share link already filled the page (restored
  // state, seeded findings, or the invalid-link warning).
  if (!restored) {
    runBtn.click();
  }
}

main().catch((e) => {
  console.error("Playground failed to start:", e);
  setStatus("Failed to start", "failure");
});
