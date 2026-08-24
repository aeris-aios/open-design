import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const targetArg = process.argv[2];
const force = process.argv.includes("--force");
if (!targetArg) {
  console.error("Usage: node scripts/new-deck.ts <output.html> [--force]");
  process.exit(2);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.cwd(), targetArg);
if (existsSync(target) && !force) {
  console.error("Target exists. Pass --force to replace it.");
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
cpSync(resolve(root, "assets/template.html"), target, { force: true });
const support = resolve(root, "assets/assets");
if (existsSync(support)) cpSync(support, resolve(dirname(target), "assets"), { recursive: true, force });
console.log(target);
