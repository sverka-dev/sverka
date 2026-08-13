import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import sitemap from "@astrojs/sitemap";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

async function loadSidebar() {
  const generatedPath = fileURLToPath(new URL("./sidebar.generated.mjs", import.meta.url));
  if (!existsSync(generatedPath)) return [];
  const mod = await import(/* @vite-ignore */ pathToFileURL(generatedPath).href);
  return mod.sidebar ?? [];
}

const sidebar = await loadSidebar();

const site = process.env.SITE_URL || "https://sverka.dev";
const baseInput = process.env.BASE_PATH || "/";
const basePath = baseInput === "/" ? "" : baseInput.replace(/\/$/, "");
const base = basePath || undefined;

const asset = (path) => `${basePath}${path}`;

const mermaidInit = `
document.addEventListener("DOMContentLoaded", function () {
  if (typeof mermaid === "undefined") return;
  const blocks = document.querySelectorAll('pre[data-language="mermaid"], pre.mermaid');
  if (!blocks.length) return;
  blocks.forEach(function (pre) {
    const code = pre.querySelector("code");
    pre.className = "mermaid";
    pre.textContent = (code && code.textContent) || pre.textContent || "";
  });
  var theme = document.documentElement.dataset.theme === "dark" ? "dark" : "default";
  mermaid.initialize({ startOnLoad: false, theme: theme });
  mermaid.run({ querySelector: ".mermaid" });
});
`;

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  output: "static",
  integrations: [
    starlight({
      title: "Sverka",
      description: "AI-first verification framework. One command. Full pipeline. Zero token waste.",
      sidebar,
      favicon: "/favicon.svg",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/sverka-dev/sverka",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/sverka-dev/sverka/edit/main/",
      },
      customCss: ["./src/styles/custom.css"],
      head: [
        {
          tag: "script",
          attrs: { src: asset("/mermaid.min.js"), defer: true },
        },
        {
          tag: "script",
          content: mermaidInit,
        },
      ],
      lastUpdated: true,
    }),
    sitemap(),
  ],
  compressHTML: true,
});
