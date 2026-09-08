/**
 * String utilities — simple functions with a deliberate bug.
 */

export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function reverse(str: string): string {
  return str.split("").reverse().join("");
}

/**
 * BUG: This function should count unique words (case-insensitive),
 * but it currently counts ALL words including duplicates.
 * Expected: "hello world hello" → 2 (not 3)
 */
export function countUniqueWords(str: string): number {
  const words = str.trim().split(/\s+/);
  return words.length;
}

/**
 * BUG: This function should truncate to maxLen characters,
 * but it truncates to maxLen - 3 (off by one with ellipsis logic).
 * Expected: truncate("hello world", 8) → "hello..." (5 chars + "...")
 * Actual: truncate("hello world", 8) → "hell..." (4 chars + "...")
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 4) + "...";
}
