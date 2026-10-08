/**
 * Private-directory invariant for predictable cache paths (CWE-377).
 *
 * Pack clone caches and the auto-derived git-registry checkout live at
 * URL-hash paths under the shared tmpdir() — anyone who knows the URL
 * can compute the path and pre-create the directory. A foreign-owned
 * dir would hand an attacker our .git/config (core.fsmonitor,
 * core.sshCommand), hooks, and every later refresh/publish. So before
 * reusing an existing dir we require: it is a real directory (lstat —
 * a symlink is refused, never followed), owned by this uid, and not
 * group/other-accessible. A missing dir is created 0o700.
 *
 * Internal seam — not exported from the package index.
 */
import { lstat, mkdir } from "node:fs/promises";

import { ArenaError, type ArenaErrorCode } from "../config.js";

export async function ensurePrivateDir(
  dir: string,
  what: string,
  code: ArenaErrorCode,
): Promise<void> {
  let st;
  try {
    st = await lstat(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // No chmod after mkdir: the gap between create and chmod would let
      // a racer swap the fresh dir for a symlink and make us tighten a
      // foreign target. The umask can only remove bits from 0o700.
      await mkdir(dir, { recursive: true, mode: 0o700 });
      return;
    }
    throw err;
  }
  if (!st.isDirectory()) {
    throw new ArenaError(
      `${what} '${dir}' is not a directory — refusing to reuse it`,
      code,
    );
  }
  // uid/mode are POSIX semantics; on Windows tmpdir() is already
  // per-user so the shared-tmpdir race does not apply.
  if (typeof process.getuid === "function") {
    if (st.uid !== process.getuid()) {
      throw new ArenaError(
        `${what} '${dir}' is owned by uid ${st.uid}, not ${process.getuid()} — refusing to reuse it`,
        code,
      );
    }
    if ((st.mode & 0o077) !== 0) {
      throw new ArenaError(
        `${what} '${dir}' is accessible by group/other (mode ${(st.mode & 0o777).toString(8).padStart(3, "0")}) — refusing to reuse it`,
        code,
      );
    }
  }
}
