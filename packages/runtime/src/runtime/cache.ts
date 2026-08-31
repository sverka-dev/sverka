export interface CacheKey {
  readonly key: string;
  readonly inputs: readonly string[];
}

export interface CacheEntry {
  readonly key: string;
  readonly outputs: readonly string[];
  readonly createdAt: string;
}

/**
 * Cache backend for incremental execution. On a cache hit the scheduler
 * skips execution and restores outputs. When omitted from SchedulerConfig,
 * caching is disabled.
 */
export interface CacheBackend {
  get(key: CacheKey): Promise<CacheEntry | undefined>;
  put(entry: CacheEntry): Promise<void>;
  restore(key: CacheKey, targetDir: string): Promise<void>;
  store(key: CacheKey, sourceDir: string): Promise<void>;
}
