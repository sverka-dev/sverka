import { describe, it, expect } from "vitest";
import { BENCHMARK_TASKS, DEFAULT_AGENTS } from "../src/index.js";
import type { Task, AgentConfig } from "../src/index.js";

describe("BENCHMARK_TASKS", () => {
  it("defines at least 5 task scenarios", () => {
    expect(BENCHMARK_TASKS.length).toBeGreaterThanOrEqual(5);
  });

  it("each task has id, name, and non-empty prompt", () => {
    for (const task of BENCHMARK_TASKS) {
      expect(task.id).toBeTruthy();
      expect(task.name).toBeTruthy();
      expect(task.prompt.length).toBeGreaterThan(20);
    }
  });

  it("task ids are unique", () => {
    const ids = BENCHMARK_TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("tasks cover simple to complex progression", () => {
    const names = BENCHMARK_TASKS.map((t) => t.name);
    expect(names).toContain("run-checks");
    expect(names).toContain("compile-github");
    expect(names).toContain("multi-step");
  });
});

describe("DEFAULT_AGENTS", () => {
  it("defines exactly 2 agents", () => {
    expect(DEFAULT_AGENTS.length).toBe(2);
  });

  it("includes raw-shell and sverka agent types", () => {
    const types = DEFAULT_AGENTS.map((a) => a.type);
    expect(types).toContain("raw-shell");
    expect(types).toContain("sverka");
  });

  it("each agent has id, name, and valid type", () => {
    for (const agent of DEFAULT_AGENTS) {
      expect(agent.id).toBeTruthy();
      expect(agent.name).toBeTruthy();
      expect(["raw-shell", "sverka"]).toContain(agent.type);
    }
  });
});
