import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout.shared";
import { BookOpen, GitBranch, Swords } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Home,
});

const cards = [
  {
    icon: BookOpen,
    title: "Docs",
    description: "Install, define checks, run locally, compile to CI.",
    href: "/docs",
    internal: true,
  },
  {
    icon: GitBranch,
    title: "Pipeline reports",
    description:
      "Live self-run and examples: DAG, timeline, SARIF findings — rendered by sverka itself.",
    href: "pipeline-reports/",
    internal: false,
  },
  {
    icon: Swords,
    title: "Arena",
    description:
      "Agent workbench — the same task with and without sverka, side by side.",
    href: "benchmark/",
    internal: false,
  },
];

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="flex flex-col flex-1 items-center justify-center px-6 py-16 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">sverka</h1>
        <p className="mt-3 max-w-xl text-fd-muted-foreground">
          Local-first checks for AI agents. Define checks in TypeScript, run
          them with one command, compile to CI when you need to.
        </p>
        <div className="mt-6 rounded-lg border bg-fd-muted/50 px-4 py-2 font-mono text-sm">
          bun add -g @sverka/cli &amp;&amp; sverka run
        </div>
        <div className="mt-12 grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;
            const inner = (
              <>
                <Icon className="size-5 text-fd-primary" />
                <div className="mt-3 font-medium">{card.title}</div>
                <div className="mt-1 text-sm text-fd-muted-foreground">
                  {card.description}
                </div>
              </>
            );
            const cls =
              "rounded-xl border p-5 text-left transition-colors hover:bg-fd-accent/50";
            return card.internal ? (
              <Link key={card.title} to={card.href} className={cls}>
                {inner}
              </Link>
            ) : (
              <a key={card.title} href={`/sverka/${card.href}`} className={cls}>
                {inner}
              </a>
            );
          })}
        </div>
        <p className="mt-16 text-xs text-fd-muted-foreground">
          Work in progress — pre-alpha. APIs may change.
        </p>
      </div>
    </HomeLayout>
  );
}
