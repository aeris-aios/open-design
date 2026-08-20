import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { uiP0CiMatrix, visualCiMatrix } from "../../lib/playwright/suites.ts";
import { evaluateScopeOutputs, matchingScopeRules, scopeConfig } from "../../../scripts/lib/scope-config.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const script = path.join(repoRoot, ".github/scripts/scopes.py");

type Plan = {
  scopes: Record<string, boolean | string>;
  enabled: Record<string, boolean>;
  matrices: { ui_p0: unknown[]; visual: unknown[] };
  trace: { escalations: unknown[]; uiP0Shadow: { mode: string; matrix: Array<{ name: string }> } };
};

function plan(context: "pr" | "merge-queue" | "full", files: string[] = []): Plan {
  return JSON.parse(execFileSync("python3", [script, "plan", "--context", context, "--files", ...files], {
    cwd: repoRoot,
    encoding: "utf8",
  })) as Plan;
}

describe("workflow scope planner", () => {
  test("keeps the JSON matrices aligned with the business-owned suite topology", () => {
    expect(scopeConfig.matrices.ui_p0).toEqual(uiP0CiMatrix);
    expect(scopeConfig.matrices.visual).toEqual(visualCiMatrix);
    expect(plan("full").matrices).toEqual({ ui_p0: uiP0CiMatrix, visual: visualCiMatrix });
  });

  test("routes representative PR changes without importing the workspace", () => {
    expect(plan("pr", ["apps/web/src/App.tsx"])).toMatchObject({
      scopes: { web_tests_required: true, ui_p0_validation_required: true, visual_validation_required: true },
      enabled: { web_workspace_tests: true, e2e_vitest: true, ui_p0: true, playwright_visual: true },
    });
    expect(plan("pr", ["apps/desktop/src/main.ts"])).toMatchObject({
      scopes: { tools_dev_tests_required: true, tools_pack_tests_required: true },
      enabled: { windows_tools_pack_payload_tests: true, ui_p0: false, playwright_critical: false },
    });
    expect(plan("pr", ["docs/spec.md"])).toMatchObject({
      scopes: { workspace_validation_required: false },
      enabled: { preflight: true, workspace_unit_tests: true, ui_p0: false },
    });
  });

  test("only certain rules can narrow the merge queue", () => {
    expect(plan("merge-queue", ["docs/spec.md"])).toMatchObject({
      enabled: { preflight: true, workspace_unit_tests: false, e2e_vitest: false },
      trace: { escalations: [] },
    });
    const medium = plan("merge-queue", ["apps/web/src/App.tsx"]);
    expect(medium.trace.escalations).toHaveLength(1);
    expect(Object.values(medium.scopes).filter((value) => typeof value === "boolean")).not.toContain(false);
  });

  test("preserves the four-domain runtime-definition shadow candidate", () => {
    const candidate = plan("pr", ["apps/daemon/src/runtimes/defs/codex.ts"]);
    expect(candidate.trace.uiP0Shadow.mode).toBe("candidate");
    expect(candidate.trace.uiP0Shadow.matrix.map((entry) => entry.name)).toEqual([
      "entry-settings", "project-workspace", "project-collab", "project-runtime",
    ]);
    expect(plan("pr", ["apps/daemon/src/server.ts"]).trace.uiP0Shadow.mode).toBe("full-fallback");
  });

  test("the TypeScript guard reader agrees with Python on promoted boundaries", () => {
    const samples = ["docs/spec.md", "apps/daemon/src/server.ts", "apps/desktop/src/main.ts"];
    for (const file of samples) {
      const pythonPlan = plan("merge-queue", [file]);
      const guardEvaluation = evaluateScopeOutputs([file], "certain");
      expect(pythonPlan.trace.escalations.length > 0).toBe(guardEvaluation.decisions[0]?.escalated);
      expect(matchingScopeRules(file).map((rule) => rule.id)).not.toHaveLength(0);
    }
  });

  test("every certain rule names a live policy-floor guard", () => {
    const registered = new Set(execFileSync("pnpm", ["--silent", "guard", "--list-checks"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim().split("\n"));
    for (const rule of scopeConfig.rules.filter((candidate) => candidate.confidence === "certain")) {
      expect(rule.guard).toBeTruthy();
      expect(registered).toContain(rule.guard);
    }
  });

  test("configuration remains a Linux workflow-control contract", () => {
    const workflow = readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain("python3 .github/scripts/scopes.py github-output");
    expect(workflow).not.toContain("scripts/scopes.ts");
    expect(workflow).not.toMatch(/windows_tools_pack_payload_tests:[\s\S]*?\.github\/scripts\/(?:scopes|hash|runners)\.py/);
  });
});
