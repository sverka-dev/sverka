import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyImageDigest } from "../image.js";
import { ImageDigestError } from "../errors.js";
import { defaultConfig } from "./helpers/fixtures.js";

vi.mock("../internal/docker-cli.js", () => ({
  runDocker: vi.fn(),
}));

import { runDocker } from "../internal/docker-cli.js";

const mockedRunDocker = vi.mocked(runDocker);

beforeEach(() => {
  mockedRunDocker.mockReset();
});

describe("verifyImageDigest", () => {
  const config = defaultConfig();
  const image = "busybox:latest";
  const digest = "sha256:abc123";

  it("resolves when local image digest matches", async () => {
    mockedRunDocker.mockResolvedValue({
      stdout: "sha256:abc123\n",
      stderr: "",
      exitCode: 0,
    });
    await expect(verifyImageDigest(image, digest, config)).resolves.toBeUndefined();
    // Should have called docker inspect only (no pull).
    expect(mockedRunDocker).toHaveBeenCalledTimes(1);
    const callArgs = mockedRunDocker.mock.calls[0]?.[0];
    expect(callArgs?.[0]).toBe("inspect");
  });

  it("throws ImageDigestError on digest mismatch", async () => {
    mockedRunDocker.mockResolvedValue({
      stdout: "sha256:wrongdigest\n",
      stderr: "",
      exitCode: 0,
    });
    await expect(verifyImageDigest(image, digest, config)).rejects.toThrow(
      ImageDigestError,
    );
    await expect(verifyImageDigest(image, digest, config)).rejects.toMatchObject({
      code: "IMAGE_DIGEST_MISMATCH",
      context: { image, expected: digest, actual: "sha256:wrongdigest" },
    });
  });

  it("pulls the image when inspect fails, then verifies", async () => {
    // inspect fails → pull succeeds → inspect again matches.
    mockedRunDocker
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "No such image",
        exitCode: 1,
      })
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: "sha256:abc123\n",
        stderr: "",
        exitCode: 0,
      });
    await expect(verifyImageDigest(image, digest, config)).resolves.toBeUndefined();
    expect(mockedRunDocker).toHaveBeenCalledTimes(3);
    expect(mockedRunDocker.mock.calls[0]?.[0]?.[0]).toBe("inspect");
    expect(mockedRunDocker.mock.calls[1]?.[0]?.[0]).toBe("pull");
    expect(mockedRunDocker.mock.calls[2]?.[0]?.[0]).toBe("inspect");
  });

  it("throws ImageDigestError after pull if digest still mismatches", async () => {
    mockedRunDocker
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "No such image",
        exitCode: 1,
      })
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: "sha256:wrongdigest\n",
        stderr: "",
        exitCode: 0,
      });
    await expect(verifyImageDigest(image, digest, config)).rejects.toThrow(
      ImageDigestError,
    );
  });
});
