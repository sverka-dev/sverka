// The hub package is an optional dependency of the CLI — its name is not
// on npm yet, so a plain `npm i sverka` has no @sverka/hub installed.
// The command must fail with a clear error, and a broken install must not
// be reported as a missing one.
import { describe, it, expect } from "vitest";

import { hubCommand, loadHub } from "../commands/hub.js";
import { CaptureWriter } from "./helpers/fixtures.js";

function moduleNotFound(): Error {
  return Object.assign(new Error("Cannot find module '@sverka/hub'"), {
    code: "MODULE_NOT_FOUND",
  });
}

describe("sverka hub — optional dependency", () => {
  const global = () => ({
    root: "/tmp/sverka-hub-test",
    format: "text" as const,
    config: null,
    quiet: false,
    verbose: false,
  });

  it("maps a missing module to a clear error", async () => {
    await expect(
      loadHub(() => Promise.reject(moduleNotFound())),
    ).rejects.toThrow(/@sverka\/hub package is not installed/);
  });

  it("rethrows an error raised inside the package unchanged", async () => {
    const boom = new Error("hub init failed");
    await expect(loadHub(() => Promise.reject(boom))).rejects.toThrow(boom);
  });

  it("rejects an unknown action before touching the missing package", async () => {
    const out = new CaptureWriter();
    await expect(
      hubCommand({ action: "nope" }, global(), out, 0),
    ).rejects.toThrow(/unknown hub action/);
  });
});
