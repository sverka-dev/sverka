import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://sverka.dev",
  output: "static",
  integrations: [sitemap()],
  compressHTML: true,
});
