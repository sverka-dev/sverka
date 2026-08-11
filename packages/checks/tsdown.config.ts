import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  treeshake: false,
  outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
});
