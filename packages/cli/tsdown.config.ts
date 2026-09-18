import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts", "src/internal/config-hooks.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
});
