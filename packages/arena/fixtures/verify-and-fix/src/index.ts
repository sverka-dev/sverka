/**
 * Text utilities — deliberately broken: a failing test, a type error,
 * an unused variable, and formatting violations.
 */

export function slugify(text: string): string {
  const unused = 'debug-marker'
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function parseVersion(v: string): number {
  return v.split('.').map(Number)
}

export function countVowels(s: string): number {
  return s.split('').filter((c) => 'aeiou'.includes(c)).length
}
