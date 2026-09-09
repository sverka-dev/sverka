// @sverka/playground — web app entry point.
// Loads Monaco editor, evaluates user pipeline code, runs checks, shows findings.

import { Project, Pipeline, FunctionStep, Entry, runPipeline } from "./index.js";
import { generateSarifHtml } from "@sverka/sarif-viewer-web/html-generator";

/** Default template shown in the editor. */
const DEFAULT_CODE = `import { Project, Pipeline, FunctionStep, Entry } from "@sverka/playground";

const proj = new Project("demo");
const checks = new Pipeline(proj, "checks");

new FunctionStep(checks, "lint", {
  fn: () => [
    { rule: "no-unused-vars", file: "src/index.ts", line: 5, severity: "high", message: "Variable 'x' is declared but never used" },
    { rule: "no-console", file: "src/utils.ts", line: 12, severity: "medium", message: "Unexpected console.log statement" },
  ],
});

new FunctionStep(checks, "typecheck", {
  fn: () => [
    { rule: "ts2322", file: "src/types.ts", line: 8, severity: "critical", message: "Type 'string' is not assignable to type 'number'" },
  ],
});

new FunctionStep(checks, "test", {
  fn: () => [
    { rule: "assertion-failed", file: "test/index.test.ts", line: 23, severity: "high", message: "Expected 5 but got 3" },
    { rule: "assertion-failed", file: "test/index.test.ts", line: 45, severity: "low", message: "Expected 'hello' but got 'world'" },
  ],
});

new Entry(checks, "on-push", { trigger: { kind: "push" }, roots: ["test"] });

export default proj;
`;

/** Strip import/export statements from user code for eval. */
function preprocessCode(code: string): string {
  return code
    // Remove import statements
    .replace(/^\s*import\s+.*?from\s+["'][^"']+["'];?\s*$/gm, "")
    // Replace "export default" with "return"
    .replace(/^\s*export\s+default\s+/m, "return ")
    // Replace "export { ... }" with nothing (named exports not supported in playground)
    .replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, "");
}

/** Evaluate user code and return the Project. */
function evaluateUserCode(code: string): Project {
  const processed = preprocessCode(code);
  const fn = new Function(
    "Project", "Pipeline", "FunctionStep", "Entry",
    processed,
  );
  const result = fn(Project, Pipeline, FunctionStep, Entry);
  if (!(result instanceof Project)) {
    throw new Error("Code must export a Project instance");
  }
  return result as Project;
}

/** Show findings HTML in the iframe. */
function showFindings(html: string): void {
  const frame = document.getElementById("findings-frame") as HTMLIFrameElement;
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
  <pre>${message.replace(/</g, "&lt;")}</pre>
</body></html>`;
  showFindings(html);
}

/** Set the status indicator. */
function setStatus(text: string, cls: string): void {
  const status = document.getElementById("status") as HTMLElement;
  status.textContent = text;
  status.className = `status ${cls}`;
}

/** Load Monaco editor from CDN. */
async function loadMonaco(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.min.js";
    script.onload = () => {
      // Monaco loader is available as global require
      const monacoRequire = (window as unknown as { require: (cfg: unknown, cb: (m: unknown) => void) => void }).require;
      monacoRequire(
        { paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" } },
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

  const monaco = (window as unknown as { monaco?: { editor: { create: (el: HTMLElement, opts: unknown) => { getValue: () => string } } } }).monaco;

  let getCode: () => string;

  const editorEl = document.getElementById("editor") as HTMLDivElement;

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
  } else {
    // Textarea fallback
    const textarea = document.createElement("textarea");
    textarea.value = DEFAULT_CODE;
    textarea.style.cssText = "width:100%;height:100%;background:#0d1117;color:#c9d1d9;border:none;font-family:monospace;font-size:13px;padding:1rem;resize:none;outline:none;";
    editorEl.appendChild(textarea);
    getCode = () => textarea.value;
  }

  // Run button
  const runBtn = document.getElementById("run-btn") as HTMLButtonElement;

  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    setStatus("Running...", "running");

    try {
      const code = getCode();
      const project = evaluateUserCode(code);
      const result = await runPipeline(project);

      if (result.findings.length === 0) {
        showFindings(`<!DOCTYPE html><html><head><style>body{background:#0d1117;color:#3fb950;font-family:monospace;padding:2rem;}</style></head><body><h2>No findings — all checks passed</h2><p>${result.steps.length} steps completed in ${result.totalDurationMs}ms</p></body></html>`);
      } else {
        const html = generateSarifHtml(result.findings);
        showFindings(html);
      }

      setStatus(
        `${result.findings.length} findings · ${result.totalDurationMs}ms`,
        result.success ? "success" : "failure",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showError(msg);
      setStatus("Error", "failure");
    } finally {
      runBtn.disabled = false;
    }
  });

  // Splitter drag
  const splitter = document.getElementById("splitter") as HTMLDivElement;
  const editorPanel = document.querySelector(".editor-panel") as HTMLElement;
  const findingsPanel = document.querySelector(".findings-panel") as HTMLElement;

  let dragging = false;
  splitter.addEventListener("mousedown", (e) => {
    dragging = true;
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const container = document.querySelector(".main") as HTMLElement;
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

  // Auto-run on load
  runBtn.click();
}

main().catch((e) => {
  console.error("Playground failed to start:", e);
  setStatus("Failed to start", "failure");
});
