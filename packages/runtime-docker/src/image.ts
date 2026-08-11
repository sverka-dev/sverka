import type { DockerExecutorConfig } from "./config.js";
import { ImageDigestError } from "./errors.js";
import { runDocker } from "./internal/docker-cli.js";

/**
 * Verify that the locally available image digest matches the declared digest.
 * Pulls the image if not present. Throws `ImageDigestError` on mismatch.
 *
 * Uses `docker inspect --format='{{json .RepoDigests}}' <image>` to read the
 * registry manifest digests for the image. If the image is absent (inspect exits
 * non-zero), runs `docker pull <image>` then inspects again.
 */
export async function verifyImageDigest(
  image: string,
  expectedDigest: string,
  config: DockerExecutorConfig,
): Promise<void> {
  const opts = {
    timeoutSeconds: 300,
    ...(config.dockerPath !== undefined
      ? { dockerPath: config.dockerPath }
      : {}),
    ...(config.dockerHost !== undefined
      ? { dockerHost: config.dockerHost }
      : {}),
  };

  let inspectResult = await runDocker(
    ["inspect", "--format={{json .RepoDigests}}", image],
    opts,
  );

  if (inspectResult.timedOut) {
    throw new ImageDigestError(
      `timed out inspecting image "${image}"`,
      { image, expected: expectedDigest },
    );
  }

  // Image not present locally — pull then re-inspect.
  if (inspectResult.exitCode !== 0) {
    const pullResult = await runDocker(["pull", image], opts);
    if (pullResult.timedOut) {
      throw new ImageDigestError(
        `timed out pulling image "${image}"`,
        { image, expected: expectedDigest },
      );
    }
    if (pullResult.exitCode !== 0) {
      throw new ImageDigestError(
        `failed to pull image "${image}": ${pullResult.stderr.trim() || pullResult.stdout.trim() || "unknown error"}`,
        { image, expected: expectedDigest },
      );
    }
    inspectResult = await runDocker(
      ["inspect", "--format={{json .RepoDigests}}", image],
      opts,
    );
    if (inspectResult.timedOut) {
      throw new ImageDigestError(
        `timed out inspecting image "${image}" after pull`,
        { image, expected: expectedDigest },
      );
    }
    if (inspectResult.exitCode !== 0) {
      throw new ImageDigestError(
        `image "${image}" missing after successful pull: ${inspectResult.stderr.trim() || inspectResult.stdout.trim()}`,
        { image, expected: expectedDigest },
      );
    }
  }

  const repoDigests = parseRepoDigests(inspectResult.stdout.trim());
  if (!repoDigests.some((d) => d === expectedDigest || d.endsWith(`@${expectedDigest}`))) {
    throw new ImageDigestError(
      `image digest mismatch for "${image}": expected ${expectedDigest}, got ${repoDigests.join(", ") || "none"}`,
      { image, expected: expectedDigest, actual: repoDigests },
    );
  }
}

function parseRepoDigests(raw: string): string[] {
  if (raw === "" || raw === "null") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map((d) => String(d));
  } catch {
    // Fall through to line-split fallback.
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
