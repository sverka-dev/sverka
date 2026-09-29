import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { appName, docsRoute, gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: appName,
    },
    links: [
      {
        text: "Docs",
        url: docsRoute,
      },
      {
        text: "Pipeline",
        url: "/sverka/pipeline-reports/sverka.html",
        external: true,
      },
      {
        text: "Arena",
        url: "/sverka/benchmark/",
        external: true,
      },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
