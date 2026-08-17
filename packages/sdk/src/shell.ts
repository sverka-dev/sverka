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
  (strings: TemplateStringsArray, ...values: readonly (string | unknown)[]): StepBuilder;
  // Shell selector: shell("bash") → new ShellProxy with shell preset.
  (interpreter: string): ShellProxy;
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
    ...values: readonly (string | unknown)[]
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
      return wrapWithPrefix(builder, prefix, shellOpt);
    }

    // No prefix — bare shell`command` or shell("bash")`command`.
    if (shellOpt) {
      return wrapWithShell(builder, shellOpt);
    }
    return builder;
  } as ShellProxy;

  // Property access: shell.git → new ShellProxy with prefix "git".
  return new Proxy(proxy, {
    get(_target, prop: string | symbol): ShellProxy {
      if (typeof prop === "string") {
        const newPrefix = prefix ? `${prefix} ${prop}` : prop;
        return createShellProxy(newPrefix, shellOpt);
      }
      return createShellProxy(prefix, shellOpt);
    },
  });
}

/**
 * Wrap a StepBuilder so the final command is prefixed with `prefix`
 * and runtime.shell is set to `shellOpt` (if provided).
 * Chain methods return the wrapper so chaining preserves the prefix/shell.
 */
function wrapWithPrefix(
  builder: StepBuilder,
  prefix: string,
  shellOpt?: string,
): StepBuilder {
  const origBuild = builder.build.bind(builder);
  const wrapped: StepBuilder = {
    outputs(o) { builder.outputs(o); return wrapped; },
    inputs(i) { builder.inputs(i); return wrapped; },
    dependsOn(s) { builder.dependsOn(s); return wrapped; },
    runtime(r) { builder.runtime(r); return wrapped; },
    timeout(ms) { builder.timeout(ms); return wrapped; },
    condition(ref) { builder.condition(ref); return wrapped; },
    build(pipeline, id) {
      const step = origBuild(pipeline, id);
      const newCommand = `${prefix} ${step.command}`;
      const runtime = shellOpt
        ? { ...step.runtime, shell: shellOpt }
        : step.runtime;
      return Object.assign(Object.create(Object.getPrototypeOf(step)), step, {
        command: newCommand,
        runtime,
      });
    },
  };
  return wrapped;
}

/**
 * Wrap a StepBuilder so runtime.shell is set to `interpreter`.
 * Used for shell("bash")`command` (no prefix).
 */
function wrapWithShell(builder: StepBuilder, interpreter: string): StepBuilder {
  const origBuild = builder.build.bind(builder);
  const wrapped: StepBuilder = {
    outputs(o) { builder.outputs(o); return wrapped; },
    inputs(i) { builder.inputs(i); return wrapped; },
    dependsOn(s) { builder.dependsOn(s); return wrapped; },
    runtime(r) { builder.runtime(r); return wrapped; },
    timeout(ms) { builder.timeout(ms); return wrapped; },
    condition(ref) { builder.condition(ref); return wrapped; },
    build(pipeline, id) {
      const step = origBuild(pipeline, id);
      const runtime: Runtime = { ...step.runtime, shell: interpreter };
      return Object.assign(Object.create(Object.getPrototypeOf(step)), step, {
        runtime,
      });
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
