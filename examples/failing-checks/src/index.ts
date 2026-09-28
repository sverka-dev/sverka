/**
 * Deliberately broken example: a type error and a failing test.
 */

export function add(a: number, b: number): number {
  return a - b; // planted bug: subtraction instead of addition
}

export function firstWord(s: string): string {
  return s.split(" "); // type error: string[] is not string
}
