import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { uiP0CiMatrix } from "../../../e2e/lib/playwright/suites.ts";
import {
  configuredMatch,
  evaluateScopeOutputs,
  matchingScopeRules,
  matchesRuleMatch,
  scopeConfig,
} from "../scope-config.ts";
import type { GuardContext } from "./core.ts";

const fullMatrixNames = [
  "entry-settings",
  "project-workspace",
  "project-workspace-editor",
  "project-collab",
  "project-runtime",
  "workspace-restoration",
] as const;
const candidateMatrixNames = [
  "entry-settings",
  "project-workspace",
  "project-collab",
  "project-runtime",
] as const;

function matrixNames(matrix: readonly { name: string }[]): string[] {
  return matrix.map((entry) => entry.name);
}

function sameValues(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

const daemonRuntimeMatch = configuredMatch("daemon-runtime-definition");
const daemonCoreMatch = configuredMatch("daemon-core");

function evaluateUiP0Shadow(files: readonly string[], filesResolved = true) {
  const candidate = filesResolved && files.length > 0 && files.every((file) => matchesRuleMatch(file, daemonRuntimeMatch));
  const names = new Set(scopeConfig.uiP0Shadow.matrixNames);
  return {
    mode: candidate ? "candidate" : "full-fallback",
    capability: candidate ? "daemon-runtime-definition" : null,
    reason: !filesResolved ? "files-unresolved" : candidate ? "capability-match" : "outside-capability",
    matrix: candidate ? uiP0CiMatrix.filter((entry) => names.has(entry.name)) : uiP0CiMatrix,
  } as const;
}

export function uiP0ShadowContractErrors(): string[] {
  const errors: string[] = [];
  if (!sameValues(matrixNames(uiP0CiMatrix), fullMatrixNames)) {
    errors.push("the applied UI P0 matrix is no longer the guarded full six-domain matrix");
  }

  const sourceSample = `${daemonRuntimeMatch.prefixes?.[0]}example.ts`;
  const testSample = daemonRuntimeMatch.exact?.find((file) => file.includes("/tests/"));
  const candidate = evaluateUiP0Shadow(testSample == null ? [sourceSample] : [sourceSample, testSample]);
  if (
    candidate.mode !== "candidate" ||
    candidate.capability !== "daemon-runtime-definition" ||
    !sameValues(matrixNames(candidate.matrix), candidateMatrixNames)
  ) {
    errors.push("the runtime-definition shadow no longer resolves to the guarded four-domain candidate");
  }

  for (const outsideFile of [
    "apps/daemon/src/server.ts",
    "apps/daemon/src/runtimes/detection.ts",
    "apps/web/src/App.tsx",
  ]) {
    const fallback = evaluateUiP0Shadow([sourceSample, outsideFile]);
    if (
      fallback.mode !== "full-fallback" ||
      fallback.reason !== "outside-capability" ||
      !sameValues(matrixNames(fallback.matrix), fullMatrixNames)
    ) {
      errors.push(`${outsideFile} no longer forces the runtime-definition shadow to the full matrix`);
    }
  }

  const unresolved = evaluateUiP0Shadow([], false);
  if (
    unresolved.mode !== "full-fallback" ||
    unresolved.reason !== "files-unresolved" ||
    !sameValues(matrixNames(unresolved.matrix), fullMatrixNames)
  ) {
    errors.push("unresolved changed files no longer force the UI P0 shadow to the full matrix");
  }
  return errors;
}

export async function checkUiP0ShadowContract(): Promise<boolean> {
  const errors = uiP0ShadowContractErrors();
  if (errors.length > 0) {
    console.error("UI P0 shadow-contract violations found:");
    for (const error of errors) console.error(`- ${error}`);
    return false;
  }
  console.log("UI P0 shadow contract check passed: applied coverage stays full and fallbacks stay closed.");
  return true;
}

const daemonCoreRuleId = "certain-daemon-core";
const daemonCoreEffects = [
  "daemon_tests_required",
  "ui_critical_validation_required",
  "ui_p0_validation_required",
  "workspace_validation_required",
] as const;

function matchingRuleIds(file: string): string[] {
  return matchingScopeRules(file).map((rule) => rule.id);
}

export function daemonCoreScopeContractErrors(): string[] {
  const errors: string[] = [];
  const samples = [
    `${daemonCoreMatch.prefixes?.[0]}server.ts`,
    `${daemonCoreMatch.prefixes?.[0]}policy.md`,
    `${daemonCoreMatch.prefixes?.[1]}server.test.ts`,
  ];

  for (const sample of samples) {
    const matched = matchingRuleIds(sample);
    if (!sameValues(matched, [daemonCoreRuleId])) {
      errors.push(`${sample} resolves to ${matched.join(", ") || "no rules"} instead of only ${daemonCoreRuleId}`);
    }
  }

  const evaluation = evaluateScopeOutputs(samples, "certain");
  const enabledEffects = Object.entries(evaluation.outputs)
    .filter(([, enabled]) => enabled)
    .map(([effect]) => effect);
  if (!sameValues(enabledEffects, daemonCoreEffects)) {
    errors.push(`daemon core effects changed from ${daemonCoreEffects.join(", ")} to ${enabledEffects.join(", ")}`);
  }
  if (evaluation.decisions.some((decision) => decision.escalated)) {
    errors.push("daemon core samples no longer resolve without certain-tier escalation");
  }

  for (const outsideFile of [
    "apps/daemon/src/sidecar/server.ts",
    `${daemonRuntimeMatch.prefixes?.[0]}example.ts`,
    daemonRuntimeMatch.exact?.[0] ?? "",
    "apps/daemon/package.json",
  ]) {
    const outside = evaluateScopeOutputs([outsideFile], "certain");
    if (!outside.decisions[0]?.escalated || matchingRuleIds(outsideFile).includes(daemonCoreRuleId)) {
      errors.push(`${outsideFile} no longer stays outside the certain daemon core`);
    }
  }
  return errors;
}

async function webDaemonFilesystemConsumers(repoRoot: string): Promise<string[]> {
  const consumers: string[] = [];
  const root = path.join(repoRoot, "apps/web/tests");

  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
        const source = await readFile(fullPath, "utf8");
        const usesFileSystem = /from\s+["']node:fs(?:\/promises)?["']/.test(source);
        const namesDaemonTree =
          source.includes("apps/daemon/") ||
          /["']apps["']\s*,\s*["']daemon["']/.test(source);
        if (usesFileSystem && namesDaemonTree) {
          consumers.push(path.relative(repoRoot, fullPath).split(path.sep).join("/"));
        }
      }
    }
  };

  await visit(root);
  return consumers.sort();
}

async function daemonCoreRepositoryContractErrors(repoRoot: string): Promise<string[]> {
  const errors = daemonCoreScopeContractErrors();
  const visualHarness = await readFile(path.join(repoRoot, "e2e/lib/playwright/visual.ts"), "utf8");
  const ciWorkflow = await readFile(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");

  for (const pattern of ["**/api/**", "**/artifacts/**", "**/frames/**", "**/powered/**"]) {
    if (!visualHarness.includes(pattern)) {
      errors.push(`visual harness no longer intercepts daemon route ${pattern}`);
    }
  }
  if (!visualHarness.includes("not mocked by visual coverage") || visualHarness.includes("route.continue()")) {
    errors.push("visual harness no longer terminates unmocked daemon routes at its browser boundary");
  }

  const obsoleteWebWalker = path.join(
    repoRoot,
    "apps/web/tests/components/Theater/critique-coverage.test.ts",
  );
  try {
    await access(obsoleteWebWalker);
    errors.push("obsolete web-owned critique walker still consumes the daemon tree");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // The authoritative cross-app walker lives in e2e/tests/critique-coverage.test.ts.
  }
  for (const consumer of await webDaemonFilesystemConsumers(repoRoot)) {
    errors.push(`${consumer} reads the daemon tree from the web test lane`);
  }

  for (const needle of [
    "fromJSON(needs.plan.outputs.run).e2e_vitest",
    "fromJSON(needs.plan.outputs.run).ui_p0",
    "pnpm --filter @open-design/e2e test",
    "include: ${{ fromJSON(needs.plan.outputs.ui_p0_matrix) }}",
  ]) {
    if (!ciWorkflow.includes(needle)) {
      errors.push(`CI workflow no longer preserves daemon-core coverage: missing ${needle}`);
    }
  }
  return errors;
}

export async function checkDaemonCoreBoundary(context: GuardContext): Promise<boolean> {
  const errors = await daemonCoreRepositoryContractErrors(context.repoRoot);
  if (errors.length > 0) {
    console.error("Daemon core boundary violations found:");
    for (const error of errors) console.error(`- ${error}`);
    return false;
  }
  console.log("Daemon core boundary check passed: retained behavior lanes and skipped consumers stay isolated.");
  return true;
}
