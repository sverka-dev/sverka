import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  base: "/sverka/",
  server: {
    port: 3000,
  },
  plugins: [
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
        prerender: {
          enabled: true,
          crawlLinks: true,
        },
      },

      pages: [{ path: "/docs" }],
      prerender: {
        // static files under public/ aren't served by the prerender server —
        // they're copied to the output verbatim, so don't crawl them
        filter: (page) =>
          !/\.(md|txt|html)$/.test(page.path) &&
          !page.path.endsWith("/benchmark/") &&
          !page.path.endsWith("/benchmark") &&
          !page.path.endsWith("/pipeline-reports/") &&
          !page.path.endsWith("/pipeline-reports"),
      },
    }),
    react(),
    // please see https://tanstack.com/start/latest/docs/framework/react/guide/hosting#nitro for guides on hosting
    nitro(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
