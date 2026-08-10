import { describe, it, expect } from "vitest";
import {
  main,
  ExitCode,
  CliError,
  ConsoleOutputWriter,
  createOutputWriter,
  type GlobalFlags,
  type OutputWriter,
  type CliErrorCode,
  type MainDeps,
  type WriteSink,
} from "../index.js";

describe("public API — exports", () => {
  it("main is a function", () => {
    expect(typeof main).toBe("function");
  });

  it("ExitCode has the four codes", () => {
    expect(ExitCode.Success).toBe(0);
    expect(ExitCode.PolicyFail).toBe(1);
    expect(ExitCode.UsageError).toBe(2);
    expect(ExitCode.RuntimeError).toBe(3);
  });

  it("CliError is constructible", () => {
    const err = new CliError("msg", "UNKNOWN_COMMAND", ExitCode.UsageError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("UNKNOWN_COMMAND");
    expect(err.exitCode).toBe(2);
  });

  it("ConsoleOutputWriter is constructible", () => {
    const w = new ConsoleOutputWriter(
      () => {},
      () => {},
    );
    expect(typeof w.write).toBe("function");
  });

  it("createOutputWriter returns a writer", () => {
    const w = createOutputWriter(
      { format: "human", config: null, root: ".", quiet: false, verbose: false },
      () => {},
      () => {},
    );
    expect(typeof w.writeLine).toBe("function");
  });

  it("all types are importable (compile-time check)", () => {
    const _g: GlobalFlags = {
      format: "human",
      config: null,
      root: ".",
      quiet: false,
      verbose: false,
    };
    const _w: OutputWriter = new ConsoleOutputWriter(() => {}, () => {});
    const _c: CliErrorCode = "UNKNOWN_COMMAND";
    const _d: MainDeps = {};
    const _s: WriteSink = () => {};
    expect(_g.format).toBe("human");
    expect(_w).toBeDefined();
    expect(_c).toBe("UNKNOWN_COMMAND");
    expect(_d).toBeDefined();
    expect(_s).toBeDefined();
  });
});
