import type { DockerExecutorConfig } from "./config.js";
import { ImageDigestError } from "./errors.js";
import { runDocker } from "./internal/docker-cli.js";

/**
 * Verify that the locally available image digest matches the declared digest.
 * Pulls the image if not present. Throws `ImageDigestError` on mismatch.
 *
 * Uses `docker inspect --format={{.Id}} <image>` to read the local digest;
 * if the image is absent (inspect exits non-zero), runs `docker pull <image>`
 * then inspects again.
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
    ["inspect", "--format={{.Id}}", image],
    opts,
  );

  // Image not present locally — pull then re-inspect.
  if (inspectResult.exitCode !== 0) {
    await runDocker(["pull", image], opts);
    inspectResult = await runDocker(
      ["inspect", "--format={{.Id}}", image],
      opts,
    );
  }

  const actualDigest = inspectResult.stdout.trim();
  if (actualDigest !== expectedDigest) {
    throw new ImageDigestError(
      `image digest mismatch for "${image}": expected ${expectedDigest}, got ${actualDigest}`,
      { image, expected: expectedDigest, actual: actualDigest },
    );
  }
}
