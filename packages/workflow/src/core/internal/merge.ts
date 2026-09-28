/** Concatenate string arrays and remove duplicates, preserving first-seen order. */
export function concatDedupe(arr: readonly string[]): string[] {
  return [...new Set(arr)];
}
