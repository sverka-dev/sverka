import type {
  LocalSignal,
  DetectedLanguage,
  DetectedPackageManager,
  PackageManagerName,
  MonorepoMarker,
  MonorepoTool,
} from "./planner.js";

// --- manifest / lockfile / dockerfile / ci / monorepo-marker rules ---

const MANIFEST_FILES: ReadonlySet<string> = new Set([
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "composer.json",
]);

const LOCKFILE_MAP: Readonly<Record<string, PackageManagerName>> = {
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "package-lock.json": "npm",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm",
  "poetry.lock": "poetry",
  "Cargo.lock": "cargo",
  "go.sum": "go",
};

const MONOREPO_MARKER_FILES: Readonly<Record<string, MonorepoTool>> = {
  "nx.json": "nx",
  "turbo.json": "turborepo",
  "lerna.json": "lerna",
  "pnpm-workspace.yaml": "pnpm-workspace",
};

/**
 * Detect local signals from a file list. Pure: no I/O.
 */
export function detectSignals(files: readonly string[]): LocalSignal[] {
  const signals: LocalSignal[] = [];
  for (const file of files) {
    const base = basename(file);
    // manifest
    if (MANIFEST_FILES.has(base)) {
      signals.push({ type: "manifest", path: file, detail: null, confidence: 1.0 });
      continue;
    }
    // lockfile
    if (base in LOCKFILE_MAP) {
      signals.push({ type: "lockfile", path: file, detail: null, confidence: 1.0 });
      continue;
    }
    // dockerfile
    if (base === "Dockerfile" || base.endsWith(".Dockerfile")) {
      signals.push({ type: "dockerfile", path: file, detail: null, confidence: 1.0 });
      continue;
    }
    // docker-compose
    if (base === "docker-compose.yml" || base === "docker-compose.yaml") {
      signals.push({ type: "docker-compose", path: file, detail: null, confidence: 1.0 });
      continue;
    }
    // ci-definition
    if (isCiDefinition(file, base)) {
      signals.push({ type: "ci-definition", path: file, detail: null, confidence: 1.0 });
      continue;
    }
    // monorepo-marker (file-based only; package.json workspaces handled in detectMonorepo)
    if (base in MONOREPO_MARKER_FILES) {
      signals.push({ type: "monorepo-marker", path: file, detail: null, confidence: 1.0 });
    }
  }
  return signals;
}

function isCiDefinition(file: string, base: string): boolean {
  if (base === ".gitlab-ci.yml" || base === "azure-pipelines.yml" || base === "Jenkinsfile") {
    return true;
  }
  if (file.startsWith(".github/workflows/") && (base.endsWith(".yml") || base.endsWith(".yaml"))) {
    return true;
  }
  if (file.startsWith(".circleci/")) {
    return true;
  }
  return false;
}

// --- language detection ---

const EXTENSION_MAP: Readonly<Record<string, string>> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".rs": "Rust",
  ".go": "Go",
  ".java": "Java",
  ".kt": "Kotlin",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".cpp": "C++",
  ".cc": "C++",
  ".cxx": "C++",
  ".c": "C",
  ".h": "C",
  ".hpp": "C++",
  ".swift": "Swift",
  ".scala": "Scala",
  ".sh": "Shell",
  ".bash": "Shell",
};

export function detectLanguages(files: readonly string[]): DetectedLanguage[] {
  const counts = new Map<string, string[]>();
  for (const file of files) {
    const ext = extname(file);
    const lang = EXTENSION_MAP[ext];
    if (!lang) continue;
    const entry = counts.get(lang);
    if (entry) {
      entry.push(ext);
    } else {
      counts.set(lang, [ext]);
    }
  }
  const out: DetectedLanguage[] = [];
  for (const [name, exts] of counts) {
    const fileCount = exts.length;
    const confidence = Math.min(1.0, fileCount / 10);
    out.push({
      name,
      confidence,
      evidence: [...new Set(exts)],
      fileCount,
    });
  }
  out.sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name));
  return out;
}

// --- package manager detection ---

export function detectPackageManagers(
  signals: readonly LocalSignal[],
  rootPkgJson: Record<string, unknown> | null,
): DetectedPackageManager[] {
  const byName = new Map<PackageManagerName, DetectedPackageManager>();
  collectLockfilePackageManagers(signals, byName);
  applyPackageManagerField(rootPkgJson, byName);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Populate `byName` from lockfile signals. */
function collectLockfilePackageManagers(
  signals: readonly LocalSignal[],
  byName: Map<PackageManagerName, DetectedPackageManager>,
): void {
  for (const sig of signals) {
    if (sig.type !== "lockfile") continue;
    const base = basename(sig.path);
    const name = LOCKFILE_MAP[base];
    if (!name) {
      // Unknown lockfile → "other"
      if (!byName.has("other")) {
        byName.set("other", {
          name: "other",
          version: null,
          lockfile: sig.path,
          evidence: [sig.path],
        });
      }
      continue;
    }
    if (!byName.has(name)) {
      byName.set(name, {
        name,
        version: null,
        lockfile: sig.path,
        evidence: [sig.path],
      });
    }
  }
}

/** Apply the `packageManager` field override from the root package.json. */
function applyPackageManagerField(
  rootPkgJson: Record<string, unknown> | null,
  byName: Map<PackageManagerName, DetectedPackageManager>,
): void {
  if (!rootPkgJson) return;
  const pm = rootPkgJson["packageManager"];
  if (typeof pm !== "string") return;
  const { tool, version } = parsePackageManager(pm);
  if (!tool) return;
  const existing = byName.get(tool);
  if (existing) {
    existing.version = version;
    if (!existing.evidence.includes("package.json#packageManager")) {
      existing.evidence.push("package.json#packageManager");
    }
  } else {
    byName.set(tool, {
      name: tool,
      version,
      lockfile: null,
      evidence: ["package.json#packageManager"],
    });
  }
}

function parsePackageManager(pm: string): {
  tool: PackageManagerName | null;
  version: string | null;
} {
  // e.g. "bun@1.3.14", "pnpm@9.12.0"
  const atIdx = pm.indexOf("@");
  if (atIdx <= 0) return { tool: null, version: null };
  const toolName = pm.slice(0, atIdx);
  const version = pm.slice(atIdx + 1) || null;
  const valid: PackageManagerName[] = [
    "npm", "yarn", "pnpm", "bun", "pip", "poetry", "uv",
    "pipenv", "cargo", "go", "maven", "gradle", "composer", "other",
  ];
  if (!valid.includes(toolName as PackageManagerName)) {
    return { tool: null, version };
  }
  return { tool: toolName as PackageManagerName, version };
}

// --- monorepo detection ---

export function detectMonorepo(
  signals: readonly LocalSignal[],
  rootPkgJson: Record<string, unknown> | null,
): MonorepoMarker | null {
  // File-based markers first.
  for (const sig of signals) {
    if (sig.type !== "monorepo-marker") continue;
    const base = basename(sig.path);
    const tool = MONOREPO_MARKER_FILES[base];
    if (tool) {
      return {
        tool,
        workspaces: [],
        evidence: [sig.path],
      };
    }
  }

  // Root package.json with workspaces field.
  if (rootPkgJson) {
    const ws = rootPkgJson["workspaces"];
    if (Array.isArray(ws) || (typeof ws === "object" && ws !== null)) {
      const globs = extractWorkspaceGlobs(ws);
      const tool: MonorepoTool = isBunWorkspace(rootPkgJson)
        ? "bun-workspace"
        : "custom";
      return {
        tool,
        workspaces: globs,
        evidence: ["package.json#workspaces"],
      };
    }
  }

  return null;
}

function extractWorkspaceGlobs(ws: unknown): string[] {
  if (Array.isArray(ws)) {
    return ws.filter((g): g is string => typeof g === "string");
  }
  if (typeof ws === "object" && ws !== null) {
    const packages = (ws as Record<string, unknown>)["packages"];
    if (Array.isArray(packages)) {
      return packages.filter((g): g is string => typeof g === "string");
    }
  }
  return [];
}

function isBunWorkspace(pkgJson: Record<string, unknown>): boolean {
  const pm = pkgJson["packageManager"];
  return typeof pm === "string" && pm.startsWith("bun");
}

// --- helpers ---

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function extname(path: string): string {
  const base = basename(path);
  const idx = base.lastIndexOf(".");
  return idx >= 0 ? base.slice(idx) : "";
}
