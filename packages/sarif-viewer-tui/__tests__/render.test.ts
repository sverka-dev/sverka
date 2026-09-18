import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderSarifTui } from "../src/render.js";
import { makeFinding } from "./helpers/fixtures.js";

type WriteFn = (chunk: unknown, ...rest: unknown[]) => boolean;

describe("renderSarifTui", () => {
  let originalIsTTY: boolean | undefined;
  let originalWrite: WriteFn;
  let captured: string[];

  beforeEach(() => {
    // Force non-TTY so the test is deterministic regardless of how vitest
    // was launched (interactive terminal vs piped).
    originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });
    captured = [];
    originalWrite = process.stdout.write.bind(process.stdout) as WriteFn;
    process.stdout.write = ((chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
  });

  it("prints findings as text when stdout is not a TTY", async () => {
    // In CI/agents there is no TTY — Ink cannot run interactively. The
    // viewer must still print the findings instead of crashing with
    // "Raw mode is not supported" and hanging.
    const finding = makeFinding({
      severity: "high",
      checkId: "eslint/no-console",
      file: "src/app.ts",
      startLine: 12,
      message: "Unexpected console statement.",
    });

    await renderSarifTui({ findings: [finding] });

    const out = captured.join("");
    expect(out).toContain("eslint/no-console");
    expect(out).toContain("src/app.ts:12");
    expect(out).toContain("Unexpected console statement.");
    expect(out).toContain("high");
  });

  it("prints a header line with the findings count", async () => {
    await renderSarifTui({ findings: [makeFinding(), makeFinding()] });
    expect(captured.join("")).toContain("SARIF findings (2):");
  });
});
