"use client";

import { useEffect, useRef } from "react";
import type { MountRunnerOptions } from "@sverka/playground";

export interface RunnerProps {
  /** Initial editor source. Defaults to the playground template. */
  readonly code?: MountRunnerOptions["code"];
  /** Render the source as a fixed listing instead of an editable field. */
  readonly readonly?: MountRunnerOptions["readonly"];
  /** Run `code` immediately on mount. Defaults to false — docs code may
   *  come from a CMS/share link, so mounting never executes it unless the
   *  page opts in or the reader clicks Run. */
  readonly autoRun?: MountRunnerOptions["autoRun"];
}

/**
 * Docs embed of the playground runner (Spec 53 — the "Run" affordance on
 * docs code examples). Mounts `mountRunner` from `@sverka/playground`
 * client-side only: the dynamic import keeps the playground bundle out of
 * the SSR/prerender path and off pages that never use it.
 */
export function Runner({ code, readonly, autoRun }: RunnerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted: { dispose(): void } | undefined;
    let cancelled = false;
    void import("@sverka/playground").then(({ mountRunner }) => {
      if (cancelled || !ref.current) return;
      mounted = mountRunner(ref.current, { code, readonly, autoRun });
    });
    return () => {
      cancelled = true;
      mounted?.dispose();
    };
  }, [code, readonly, autoRun]);

  return <div ref={ref} className="sverka-runner not-prose min-h-96" />;
}
