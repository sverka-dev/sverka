// TieredCacheStore — local-first, remote-backed CacheStore composition.
// Spec 55 — "the hub is a read/write-through cache… every remote failure
// degrades to local behaviour + a warn diagnostic".

import type {
  CacheRestoreRequest,
  CacheRestoreResult,
  CacheStore,
  CacheStoreRequest,
} from "@sverka/runtime";

export interface TieredCacheStoreConfig {
  readonly local: CacheStore;
  readonly remote: CacheStore;
  /** Warn channel — receives `remote.cache-unreachable`-style messages.
   *  Each distinct message is emitted once per store instance. */
  readonly onWarn?: (message: string) => void;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Compose a local and a remote cache store:
 *
 * - `restore`: local hit wins; on a local miss the remote is consulted and
 *   a remote hit is written back into the local store (write-through).
 *   A remote failure degrades to "miss" plus a `remote.cache-unreachable`
 *   warn — never a throw.
 * - `store`: writes to both; failures on either side warn and continue.
 *
 * The returned store never throws for remote errors — a `sverka run` must
 * not fail because the hub is down.
 */
export function createTieredCacheStore(
  config: TieredCacheStoreConfig,
): CacheStore {
  const warned = new Set<string>();
  const warn = (msg: string): void => {
    if (warned.has(msg)) return;
    warned.add(msg);
    config.onWarn?.(msg);
  };

  return {
    async restore(
      req: CacheRestoreRequest,
    ): Promise<CacheRestoreResult | undefined> {
      let localHit: CacheRestoreResult | undefined;
      try {
        localHit = await config.local.restore(req);
      } catch (e) {
        warn(`local cache restore failed: ${message(e)}`);
      }
      if (localHit !== undefined) return localHit;

      let remoteHit: CacheRestoreResult | undefined;
      try {
        remoteHit = await config.remote.restore(req);
      } catch (e) {
        warn(`remote.cache-unreachable: ${message(e)}`);
        return undefined;
      }
      if (remoteHit === undefined) return undefined;

      // Write-through: the remote just populated req.targetDir — mirror it
      // into the local store so subsequent runs hit locally.
      try {
        await config.local.store({
          key: remoteHit.key,
          paths: req.paths,
          sourceDir: req.targetDir,
        });
      } catch (e) {
        warn(`local cache write-back failed: ${message(e)}`);
      }
      return remoteHit;
    },

    async store(req: CacheStoreRequest): Promise<void> {
      try {
        await config.local.store(req);
      } catch (e) {
        warn(`local cache store failed: ${message(e)}`);
      }
      try {
        await config.remote.store(req);
      } catch (e) {
        warn(`remote.cache-unreachable: ${message(e)}`);
      }
    },
  };
}
