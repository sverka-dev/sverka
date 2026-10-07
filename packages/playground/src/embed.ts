// @sverka/playground — mountRunner embed API (Spec 53).
// Docs pages mount a self-contained runner: code (editable or readonly),
// a Run button, status line, and a findings iframe. Zero backend — the
// runner evaluates pipeline code in-page under the same trust model as
// the full playground (see engine.ts).

import { generateSarifHtml } from "@sverka/sarif-viewer-web/html-generator";
import type { PipelineResult } from "./types.js";
import {
  DEFAULT_CODE,
  escapeHtml,
  evaluateUserCode,
  runPipelineWithTimeout,
} from "./engine.js";

export interface MountRunnerOptions {
  /** Initial editor source. Defaults to the playground template. */
  readonly code?: string;
  /** Render the source as a fixed listing instead of an editable field. */
  readonly readonly?: boolean;
  /** Run `code` immediately on mount. Defaults to false — embed code may
   *  come from a share link or CMS, so mounting never executes it unless
   *  the embedder opts in or the user clicks Run. */
  readonly autoRun?: boolean;
  /** Called once per completed run. */
  readonly onRun?: (result: PipelineResult) => void;
}

export interface MountedRunner {
  /** Remove the runner's DOM and listeners. */
  dispose(): void;
}

const STYLE = `
  font-family: monospace; font-size: 12px;
  background: #0d1117; color: #c9d1d9;
  border: 1px solid #30363d; border-radius: 6px;
  display: flex; flex-direction: column; overflow: hidden;
`;

/**
 * Mount a self-contained runner inside `el`. `dispose()` tears the mount
 * down. With `autoRun: true` the runner executes `code` once on mount;
 * otherwise it waits for the Run button — embeds never auto-execute code
 * the embedder didn't explicitly allow.
 */
export function mountRunner(
  el: HTMLElement,
  opts: MountRunnerOptions = {},
): MountedRunner {
  const doc = el.ownerDocument;
  const code = opts.code ?? DEFAULT_CODE;

  const root = doc.createElement("div");
  root.setAttribute("style", STYLE);

  const header = doc.createElement("div");
  header.setAttribute(
    "style",
    "display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.6rem;background:#161b22;border-bottom:1px solid #30363d;",
  );

  const runBtn = doc.createElement("button");
  runBtn.textContent = "Run";
  runBtn.setAttribute(
    "style",
    "padding:0.2rem 0.8rem;border:1px solid #30363d;border-radius:6px;background:#1f6feb;color:#fff;cursor:pointer;font-size:0.8rem;",
  );

  const status = doc.createElement("span");
  status.setAttribute("style", "font-size:0.75rem;color:#8b949e;");
  status.textContent = "Ready";

  header.append(runBtn, status);
  root.appendChild(header);

  let codeEl: HTMLTextAreaElement | HTMLElement;
  if (opts.readonly) {
    const pre = doc.createElement("pre");
    pre.setAttribute(
      "style",
      "margin:0;padding:0.75rem;overflow:auto;max-height:16rem;white-space:pre;",
    );
    pre.textContent = code;
    codeEl = pre;
  } else {
    const textarea = doc.createElement("textarea");
    textarea.value = code;
    textarea.setAttribute(
      "style",
      "flex:0 0 12rem;width:100%;background:#0d1117;color:#c9d1d9;border:none;border-bottom:1px solid #30363d;padding:0.75rem;resize:vertical;outline:none;font:inherit;",
    );
    codeEl = textarea;
  }
  root.appendChild(codeEl);

  const frame = doc.createElement("iframe");
  // Shared findings render via srcdoc — sandboxed onto an opaque origin so a
  // crafted payload can never touch the host page; allow-scripts keeps the
  // report's own viewer interactivity (search/filter/sort) working.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute(
    "style",
    "flex:1;min-height:10rem;width:100%;border:none;background:#0d1117;",
  );
  root.appendChild(frame);

  el.appendChild(root);

  // Branch on the option, not instanceof — a container owned by another
  // window would produce a cross-realm textarea that fails the check.
  const getCode = (): string =>
    opts.readonly === true ? code : (codeEl as HTMLTextAreaElement).value;

  const showFindings = (html: string): void => {
    frame.srcdoc = html;
  };

  const run = async (): Promise<void> => {
    runBtn.disabled = true;
    status.textContent = "Running...";
    let result: PipelineResult;
    try {
      const project = evaluateUserCode(getCode());
      result = await runPipelineWithTimeout(project, 30_000);
      if (!result.success) {
        const failed = result.steps.filter((s) => s.status === "failure");
        const banner = `<div style="background:#3d1d1f;color:#f85149;padding:0.6rem 1rem;font-family:monospace;border-bottom:1px solid #30363d;"><strong>Run failed</strong><pre style="margin:0.4rem 0 0;white-space:pre-wrap;">${escapeHtml(
          failed.map((s) => `${s.stepId}: ${s.error ?? "failed"}`).join("\n") ||
            `${result.steps.length} steps failed`,
        )}</pre></div>`;
        if (result.findings.length > 0) {
          // Steps that finished before the failure still produced
          // findings — show the report with the failure note on top
          // rather than hiding the findings behind the error.
          const sarif = generateSarifHtml(result.findings);
          showFindings(
            sarif.includes("<body>")
              ? sarif.replace("<body>", `<body>${banner}`)
              : banner + sarif,
          );
        } else {
          showFindings(
            `<!DOCTYPE html><html><body style="background:#0d1117;color:#f85149;font-family:monospace;padding:1rem;">${banner}</body></html>`,
          );
        }
      } else if (result.findings.length === 0) {
        showFindings(
          `<!DOCTYPE html><html><body style="background:#0d1117;color:#3fb950;font-family:monospace;padding:1rem;"><h3>No findings — all checks passed</h3><p>${escapeHtml(String(result.steps.length))} steps in ${escapeHtml(String(result.totalDurationMs))}ms</p></body></html>`,
        );
      } else {
        showFindings(generateSarifHtml(result.findings));
      }
      status.textContent = result.success
        ? `${result.findings.length} findings · ${result.totalDurationMs}ms`
        : `${result.steps.filter((s) => s.status === "failure").length} step(s) failed · ${result.findings.length} findings`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showFindings(
        `<!DOCTYPE html><html><body style="background:#0d1117;color:#f85149;font-family:monospace;padding:1rem;"><h3>Error</h3><pre>${escapeHtml(msg)}</pre></body></html>`,
      );
      status.textContent = "Error";
      runBtn.disabled = false;
      return;
    }
    runBtn.disabled = false;
    // Outside the try — a throwing callback must not corrupt the findings
    // view or get misreported as a runner failure.
    opts.onRun?.(result);
  };

  const onClick = (): void => {
    void run();
  };
  runBtn.addEventListener("click", onClick);
  if (opts.autoRun === true) void run();

  return {
    dispose() {
      runBtn.removeEventListener("click", onClick);
      root.remove();
    },
  };
}
