import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep } from "@sverka/cdk";
import { shell } from "../index.js";

describe("Shell proxy — command prefix", () => {
  it("prepends property name to command", () => {
    const project = new Project("shell-prefix");
    const pipeline = new Pipeline(project, "ci");
    const step = shell.git!`push origin main`.build(pipeline, "push");
    expect(step).toBeInstanceOf(ShellStep);
    expect(step.command).toBe("git push origin main");
  });

  it("prepends multiple property accesses", () => {
    const project = new Project("shell-multi-prefix");
    const pipeline = new Pipeline(project, "ci");
    const step = shell.git.remote!`show`.build(pipeline, "show");
    expect(step.command).toBe("git remote show");
  });

  it("works with interpolation", () => {
    const project = new Project("shell-interp");
    const pipeline = new Pipeline(project, "ci");
    const step = shell.bun!`run ${"build"}`.build(pipeline, "build");
    expect(step.command).toBe("bun run build");
  });

  it("chaining still works after prefix", () => {
    const project = new Project("shell-chain");
    const pipeline = new Pipeline(project, "ci");
    const step = shell.git!`push`
      .dependsOn(["build"])
      .build(pipeline, "push");
    expect(step.command).toBe("git push");
    expect(step.dependsOn).toEqual(["build"]);
  });

  it("default shell (no selector) — runtime.shell is undefined", () => {
    const project = new Project("shell-default");
    const pipeline = new Pipeline(project, "ci");
    const step = shell.git!`push`.build(pipeline, "push");
    expect(step.runtime.shell).toBeUndefined();
  });
});

describe("Shell proxy — shell selector", () => {
  it("shell(interpreter) sets runtime.shell on bare template", () => {
    const project = new Project("shell-selector-bare");
    const pipeline = new Pipeline(project, "ci");
    const step = shell("bash")`echo hello`.build(pipeline, "greet");
    expect(step.command).toBe("echo hello");
    expect(step.runtime.shell).toBe("bash");
  });

  it("shell(interpreter).prefix sets both command prefix and runtime.shell", () => {
    const project = new Project("shell-selector-prefix");
    const pipeline = new Pipeline(project, "ci");
    const step = shell("bash").git!`push`.build(pipeline, "push");
    expect(step.command).toBe("git push");
    expect(step.runtime.shell).toBe("bash");
  });

  it("shell('pwsh') bare template sets runtime.shell", () => {
    const project = new Project("shell-pwsh");
    const pipeline = new Pipeline(project, "ci");
    const step = shell("pwsh")`Write-Host hello`.build(pipeline, "greet");
    expect(step.command).toBe("Write-Host hello");
    expect(step.runtime.shell).toBe("pwsh");
  });

  it("destructure from selector", () => {
    const project = new Project("shell-destructure");
    const pipeline = new Pipeline(project, "ci");
    const bash = shell("bash");
    const step = bash.git!`push`.build(pipeline, "push");
    expect(step.command).toBe("git push");
    expect(step.runtime.shell).toBe("bash");
  });

  it("chaining works with selector + prefix", () => {
    const project = new Project("shell-selector-chain");
    const pipeline = new Pipeline(project, "ci");
    const step = shell("bash").git!`push`
      .dependsOn(["build"])
      .build(pipeline, "push");
    expect(step.command).toBe("git push");
    expect(step.runtime.shell).toBe("bash");
    expect(step.dependsOn).toEqual(["build"]);
  });
});

describe("Shell proxy — bare shell`command`", () => {
  it("bare shell template works like $ (no prefix)", () => {
    const project = new Project("shell-bare");
    const pipeline = new Pipeline(project, "ci");
    const step = shell`make build`.build(pipeline, "build");
    expect(step.command).toBe("make build");
    expect(step.runtime.shell).toBeUndefined();
  });
});
