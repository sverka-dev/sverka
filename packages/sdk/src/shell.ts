// Shell proxy: command-prefix + shell-selector API.
// Spec 03 — §9.2. Issue sv-kbu6.

import type { Runtime, Reference } from "@sverka/cdk";
import type { StepBuilder } from "./dollar.js";
import { $ } from "./dollar.js";

/**
 * ShellProxy — callable tagged template + property access (command prefix)
 * + callable with interpreter string (shell selector).
 *
 * - `shell.git`push origin`` → command "git push origin"
 * - `shell("bash").git`push`` → command "git push" + runtime.shell="bash"
 * - `shell("pwsh")`Write-Host hi`` → command "Write-Host hi" + runtime.shell="pwsh"
 */
export interface ShellProxy {
  // Tagged template: bare shell`command` → StepBuilder (no prefix).
  (strings: TemplateStringsArray, ...values: readonly unknown[]): StepBuilder;
  // Shell selector: shell("bash") → new ShellProxy with shell preset.
  (interpreter: string): ShellProxy;
  // Common command prefixes — named properties avoid | undefined under
  // noUncheckedIndexedAccess and provide autocomplete. The index signature
  // below covers any other string prefix dynamically.
  readonly git: ShellProxy;
  readonly npm: ShellProxy;
  readonly npx: ShellProxy;
  readonly bun: ShellProxy;
  readonly pnpm: ShellProxy;
  readonly yarn: ShellProxy;
  readonly docker: ShellProxy;
  readonly make: ShellProxy;
  readonly cargo: ShellProxy;
  readonly go: ShellProxy;
  readonly python: ShellProxy;
  readonly pip: ShellProxy;
  // Command prefix: shell.git`push` → StepBuilder with "git push".
  readonly [key: string]: ShellProxy;
}

/**
 * Create a ShellProxy bound to an optional command prefix and shell interpreter.
 * - prefix: accumulated property-access chain (e.g. "git" for shell.git)
 * - shellOpt: interpreter string from shell("bash"), applied as runtime.shell
 */
function createShellProxy(prefix: string, shellOpt?: string): ShellProxy {
  const proxy: ShellProxy = function (
    stringsOrInterpreter: TemplateStringsArray | string,
    ...values: readonly unknown[]
  ): StepBuilder | ShellProxy {
    // Function call with interpreter string: shell("bash") → new proxy.
    if (typeof stringsOrInterpreter === "string") {
      return createShellProxy(prefix, stringsOrInterpreter);
    }

    // Tagged template: build the command.
    // $ validates interpolation values at runtime (throws INVALID_INTERPOLATION);
    // cast to satisfy its (string | Reference) signature.
    const builder = $(stringsOrInterpreter, ...(values as readonly (string | Reference)[]));

    // Prepend command prefix if set (e.g. "git " for shell.git`push`).
    if (prefix) {
      return wrapBuilder(builder, (step) => applyPrefixAndShell(step, prefix, shellOpt));
    }

    // No prefix — bare shell`command` or shell("bash")`command`.
    if (shellOpt) {
      return wrapBuilder(builder, (step) => applyShell(step, shellOpt));
    }
    return builder;
  } as ShellProxy;

  // Property access: shell.git → new ShellProxy with prefix "git".
  return new Proxy(proxy, {
    get(_target, prop: string | symbol): ShellProxy | undefined {
      // Guard against thenable/introspection props (then, toJSON, etc.)
      if (typeof prop !== "string") return undefined;
      if (prop === "then" || prop === "toJSON" || prop === "toString") return undefined;
      const newPrefix = prefix ? `${prefix} ${prop}` : prop;
      return createShellProxy(newPrefix, shellOpt);
    },
  });
}

/**
 * Apply a command prefix and optional shell interpreter to a built step.
 * Mutates the step in-place to preserve pipeline registration.
 */
function applyPrefixAndShell(
  step: ReturnType<StepBuilder["build"]>,
  prefix: string,
  shellOpt?: string,
): ReturnType<StepBuilder["build"]> {
  const runtime = shellOpt
    ? { ...step.runtime, shell: shellOpt }
    : step.runtime;
  Object.assign(step, { command: `${prefix} ${step.command}`, runtime });
  return step;
}

/**
 * Apply a shell interpreter to a built step (no prefix).
 * Mutates the step in-place to preserve pipeline registration.
 */
function applyShell(
  step: ReturnType<StepBuilder["build"]>,
  interpreter: string,
): ReturnType<StepBuilder["build"]> {
  const runtime: Runtime = { ...step.runtime, shell: interpreter };
  Object.assign(step, { runtime });
  return step;
}

/**
 * Wrap a StepBuilder so `build()` applies a transform to the final step.
 * Chain methods delegate to the original builder and return the wrapper.
 */
function wrapBuilder(
  builder: StepBuilder,
  transform: (step: ReturnType<StepBuilder["build"]>) => ReturnType<StepBuilder["build"]>,
): StepBuilder {
  const origBuild = builder.build.bind(builder);
  const wrapped: StepBuilder = {
    outputs(o) { builder.outputs(o); return wrapped; },
    inputs(i) { builder.inputs(i); return wrapped; },
    dependsOn(s) { builder.dependsOn(s); return wrapped; },
    runtime(r) { builder.runtime(r); return wrapped; },
    timeout(ms) { builder.timeout(ms); return wrapped; },
    condition(ref) { builder.condition(ref); return wrapped; },
    matrix(spec) { builder.matrix(spec); return wrapped; },
    interruptible(value) { builder.interruptible(value); return wrapped; },
    build(pipeline, id) {
      return transform(origBuild(pipeline, id));
    },
  };
  return wrapped;
}

/**
 * Shell proxy export. Provides command-prefix and shell-selector DX.
 *
 * @example
 * const { git, npm, bun, make, docker } = shell;
 * git`push origin main`.build(p, "push")  // → "git push origin main"
 * bun`run build`.build(p, "build")        // → "bun run build"
 *
 * @example
 * const bash = shell("bash");
 * bash.git`push`.build(p, "push")         // → "git push" + runtime.shell="bash"
 * shell("pwsh")`Write-Host hello`.build(p, "greet")  // → "Write-Host hello" + runtime.shell="pwsh"
 */
export const shell: ShellProxy = createShellProxy("");
