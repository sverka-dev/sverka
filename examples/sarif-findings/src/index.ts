// Example file the mock "linter" reports findings against.
export const API_TOKEN = "sk-example-hardcoded-token";

let counter = 0;
export function bump(): number {
  counter += 1;
  return counter;
}
