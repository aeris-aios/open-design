import { readFileSync } from "node:fs";
import path from "node:path";

type Match = {
  prefixes?: string[];
  exact?: string[];
  regexes?: string[];
  include?: string[];
  exclude?: string[];
};

type ScopeRule = {
  id: string;
  match: Match;
  effects: string[];
  confidence: "medium" | "certain";
  guard?: string;
};

type ScopeConfig = {
  effects: string[];
  matches: Record<string, Match>;
  rules: ScopeRule[];
  matrices: { ui_p0: Array<{ name: string; shard: string }>; visual: Array<{ name: string; files: string }> };
  uiP0Shadow: { match: string; matrixNames: string[] };
};

const repoRoot = path.resolve(import.meta.dirname, "../..");
export const scopeConfig = JSON.parse(
  readFileSync(path.join(repoRoot, ".github/config/scopes.json"), "utf8"),
) as ScopeConfig;

function tokenMatches(file: string, token: string): boolean {
  if (token.startsWith("match://")) {
    const match = scopeConfig.matches[token.slice("match://".length)];
    if (match == null) throw new Error(`unknown configured scope match ${token}`);
    return matchesRuleMatch(file, match);
  }
  if (token.startsWith("prefix://")) return file.startsWith(token.slice("prefix://".length));
  throw new Error(`unsupported configured scope token ${token}`);
}

export function matchesRuleMatch(file: string, match: Match): boolean {
  const positives = [
    ...(match.prefixes ?? []).map((prefix) => file.startsWith(prefix)),
    ...(match.exact ?? []).map((exact) => file === exact),
    ...(match.regexes ?? []).map((pattern) => new RegExp(pattern).test(file)),
    ...(match.include ?? []).map((token) => tokenMatches(file, token)),
  ];
  if (positives.length > 0 && !positives.some(Boolean)) return false;
  return !(match.exclude ?? []).some((token) => tokenMatches(file, token));
}

export function matchingScopeRules(file: string): ScopeRule[] {
  return scopeConfig.rules.filter((rule) => matchesRuleMatch(file, rule.match));
}

export function evaluateScopeOutputs(files: readonly string[], threshold: "medium" | "certain") {
  const rank = { medium: 0, certain: 1 } as const;
  const outputs = Object.fromEntries(scopeConfig.effects.map((effect) => [effect, false])) as Record<string, boolean>;
  const decisions: Array<{ file: string; matchedRules: string[]; escalated: boolean }> = [];
  for (const file of files) {
    const matched = matchingScopeRules(file);
    const escalated = matched.length === 0 || matched.some((rule) => rank[rule.confidence] < rank[threshold]);
    if (escalated) {
      for (const effect of scopeConfig.effects) outputs[effect] = true;
    } else {
      for (const rule of matched) for (const effect of rule.effects) outputs[effect] = true;
    }
    decisions.push({ file, matchedRules: matched.map((rule) => rule.id), escalated });
  }
  return { outputs, decisions };
}

export function configuredMatch(name: string): Match {
  const match = scopeConfig.matches[name];
  if (match == null) throw new Error(`unknown configured scope match ${name}`);
  return match;
}
