import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import sitemap from "@astrojs/sitemap";
import { sidebar } from "./sidebar.generated.mjs";

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
      description: "Define checks once. Plan locally. Run anywhere.",
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
