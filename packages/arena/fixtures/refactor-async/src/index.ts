/**
 * Data fetcher using callback style — needs refactoring to async/await.
 *
 * TODO: Refactor all functions to use async/await instead of callbacks.
 *       Do NOT change the function signatures or test expectations.
 *       Do NOT change the return types — they should return Promises.
 */

import fs from "node:fs";

type Callback<T> = (err: Error | null, data: T) => void;

/** Read a file and parse as JSON — callback style. */
export function readJsonFile(path: string, cb: Callback<unknown>): void {
  fs.readFile(path, "utf-8", (err, content) => {
    if (err) {
      cb(err, null as unknown);
      return;
    }
    try {
      const data = JSON.parse(content);
      cb(null, data);
    } catch (e) {
      cb(e instanceof Error ? e : new Error(String(e)), null as unknown);
    }
  });
}

/** Write JSON to a file — callback style. */
export function writeJsonFile(path: string, data: unknown, cb: Callback<void>): void {
  try {
    const content = JSON.stringify(data, null, 2);
    fs.writeFile(path, content, "utf-8", (err) => {
      if (err) {
        cb(err, undefined);
        return;
      }
      cb(null, undefined);
    });
  } catch (e) {
    cb(e instanceof Error ? e : new Error(String(e)), undefined);
  }
}

/** Fetch data from multiple files and combine — callback style. */
export function combineFiles(
  paths: string[],
  cb: Callback<unknown[]>,
): void {
  const results: unknown[] = [];
  let done = 0;
  let failed = false;

  paths.forEach((path, i) => {
    readJsonFile(path, (err, data) => {
      if (failed) return;
      if (err) {
        failed = true;
        cb(err, []);
        return;
      }
      results[i] = data;
      done++;
      if (done === paths.length) {
        cb(null, results);
      }
    });
  });
}
