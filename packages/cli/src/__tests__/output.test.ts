import { describe, it, expect } from "vitest";
import {
  CliError,
  ExitCode,
  type CliErrorCode,
  type GlobalFlags,
  type OutputWriter,
  ConsoleOutputWriter,
  createOutputWriter,
} from "../index.js";
import { CaptureWriter } from "./helpers/fixtures.js";

describe("ExitCode", () => {
  it("has the four spec exit codes", () => {
    expect(ExitCode.Success).toBe(0);
    expect(ExitCode.PolicyFail).toBe(1);
    expect(ExitCode.UsageError).toBe(2);
    expect(ExitCode.RuntimeError).toBe(3);
  });
});

describe("CliError", () => {
  it("constructs with message, code, exitCode", () => {
    const err = new CliError("bad", "UNKNOWN_COMMAND", ExitCode.UsageError);
    expect(err.message).toBe("bad");
    expect(err.code).toBe("UNKNOWN_COMMAND");
    expect(err.exitCode).toBe(2);
    expect(err.name).toBe("CliError");
    expect(err.cause).toBeUndefined();
  });

  it("preserves cause when provided", () => {
    const inner = new Error("inner");
    const err = new CliError(
      "wrap",
      "SDK_ERROR",
      ExitCode.RuntimeError,
      inner,
    );
    expect(err.cause).toBe(inner);
  });

  it("all error codes are constructible", () => {
    const codes: CliErrorCode[] = [
      "UNKNOWN_COMMAND",
      "MISSING_ARG",
      "INVALID_FLAG",
      "CONFIG_EXISTS",
      "RUNTIME_NOT_AVAILABLE",
      "SDK_ERROR",
    ];
    for (const code of codes) {
      const err = new CliError("msg", code, ExitCode.UsageError);
      expect(err.code).toBe(code);
    }
  });

  it("is an Error instance", () => {
    const err = new CliError("x", "MISSING_ARG", ExitCode.UsageError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("ConsoleOutputWriter", () => {
  it("writes to stdout and stderr via provided sinks", () => {
    const out: string[] = [];
    const err: string[] = [];
    const w = new ConsoleOutputWriter(
      (s) => out.push(s),
      (s) => err.push(s),
    );
    w.write("a");
    w.writeLine("b");
    w.error("e");
    w.errorLine("f");
    expect(out.join("")).toBe("ab\n");
    expect(err.join("")).toBe("ef\n");
  });
});

describe("createOutputWriter", () => {
  it("suppresses stdout when quiet (human format)", () => {
    const out: string[] = [];
    const err: string[] = [];
    const w = createOutputWriter(
      { format: "human", config: null, root: ".", quiet: true, verbose: false },
      (s) => out.push(s),
      (s) => err.push(s),
    );
    w.writeLine("should be suppressed");
    w.errorLine("still shown");
    expect(out.join("")).toBe("");
    expect(err.join("")).toBe("still shown\n");
  });

  it("does NOT suppress stdout in json format even when quiet", () => {
    const out: string[] = [];
    const err: string[] = [];
    const w = createOutputWriter(
      { format: "json", config: null, root: ".", quiet: true, verbose: false },
      (s) => out.push(s),
      (s) => err.push(s),
    );
    w.writeLine('{"command":"inspect"}');
    expect(out.join("")).toBe('{"command":"inspect"}\n');
  });

  it("writes verbose debug to stderr when verbose", () => {
    const out: string[] = [];
    const err: string[] = [];
    const w = createOutputWriter(
      { format: "human", config: null, root: ".", quiet: false, verbose: true },
      (s) => out.push(s),
      (s) => err.push(s),
    );
    w.debug("debug info");
    expect(err.join("")).toBe("debug info\n");
  });

  it("does not write debug when not verbose", () => {
    const err: string[] = [];
    const w = createOutputWriter(
      { format: "human", config: null, root: ".", quiet: false, verbose: false },
      () => {},
      (s) => err.push(s),
    );
    w.debug("nope");
    expect(err.join("")).toBe("");
  });
});

describe("types (compile-time check)", () => {
  it("GlobalFlags and OutputWriter are importable", () => {
    const _g: GlobalFlags = {
      format: "human",
      config: null,
      root: ".",
      quiet: false,
      verbose: false,
    };
    const _w: OutputWriter = new CaptureWriter();
    expect(_g.format).toBe("human");
    expect(_w).toBeDefined();
  });
});
