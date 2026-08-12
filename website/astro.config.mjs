import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const site = process.env.SITE_URL || "https://sverka.dev";
const baseInput = process.env.BASE_PATH || "/";
const base = baseInput.endsWith("/") ? baseInput : `${baseInput}/`;

export default defineConfig({
  site,
  base,
  output: "static",
  integrations: [sitemap()],
  compressHTML: true,
});
