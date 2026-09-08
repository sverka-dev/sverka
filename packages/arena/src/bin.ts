#!/usr/bin/env node
import process from "node:process";
// Stub — will be implemented in next phase
async function main(): Promise<number> {
  process.stderr.write("arena CLI — not yet implemented\n");
  return 1;
}

const code = await main();
process.exit(code);
