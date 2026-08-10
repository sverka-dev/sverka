#!/usr/bin/env node
import process from "node:process";
import { main } from "./main.js";

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch(() => process.exit(3));
