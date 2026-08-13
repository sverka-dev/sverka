import type { DockerRunOptions } from "./internal/docker-cli.js";
import type { DockerDriverConfig } from "./config.js";
import { ImageDigestError } from "./errors.js";
import { runDocker } from "./internal/docker-cli.js";

type DockerResult = Awaited<ReturnType<typeof runDocker>>;

function dockerOptions(config: DockerDriverConfig): DockerRunOptions {
  return {
    timeoutSeconds: 300,
    ...(config.dockerPath !== undefined ? { dockerPath: config.dockerPath } : {}),
    ...(config.dockerHost !== undefined ? { dockerHost: config.dockerHost } : {}),
  };
}

function dockerInspect(image: string, opts: DockerRunOptions) {
  return runDocker(["inspect", "--format={{json .RepoDigests}}", image], opts);
}

function dockerPull(image: string, opts: DockerRunOptions) {
  return runDocker(["pull", image], opts);
}

function assertInspectOk(
  result: DockerResult,
  image: string,
  expectedDigest: string,
  phase: string,
): void {
  if (result.timedOut) {
    throw new ImageDigestError(
      `timed out inspecting image "${image}" ${phase}`,
      { image, expected: expectedDigest },
    );
  }
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "unknown error";
    throw new ImageDigestError(
      `image "${image}" inspect failed ${phase}: ${detail}`,
      { image, expected: expectedDigest },
    );
  }
}

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
  config: DockerDriverConfig,
): Promise<void> {
  const opts = dockerOptions(config);

  let inspectResult = await dockerInspect(image, opts);

  if (inspectResult.exitCode !== 0) {
    const pullResult = await dockerPull(image, opts);
    if (pullResult.timedOut) {
      throw new ImageDigestError(
        `timed out pulling image "${image}"`,
        { image, expected: expectedDigest },
      );
    }
    if (pullResult.exitCode !== 0) {
      const detail = pullResult.stderr.trim() || pullResult.stdout.trim() || "unknown error";
      throw new ImageDigestError(
        `failed to pull image "${image}": ${detail}`,
        { image, expected: expectedDigest },
      );
    }
    inspectResult = await dockerInspect(image, opts);
  }

  assertInspectOk(inspectResult, image, expectedDigest, inspectResult.exitCode === 0 ? "" : "after pull");

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
