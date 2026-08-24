import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fileArg = process.argv[2];
if (!fileArg) {
  console.error("Usage: node scripts/validate-deck.ts <deck.html>");
  process.exit(2);
}
const html = readFileSync(resolve(process.cwd(), fileArg), "utf8");
const errors = [];
if (!/<!doctype html>/i.test(html)) errors.push("Missing HTML doctype.");
if (!/<title>[\s\S]*?<\/title>/i.test(html)) errors.push("Missing document title.");
const classSlides = [...html.matchAll(/class=["']([^"']*)["']/gi)]
  .filter((match) => match[1].split(/\s+/).includes("slide")).length;
const sections = (html.match(/<section\b/gi) ?? []).length;
const dataSlides = (html.match(/data-(?:slide|screen|page)=/gi) ?? []).length;
const slideCount = Math.max(classSlides, sections, dataSlides);
if (slideCount < 3) errors.push(`Expected at least 3 slides; found ${slideCount}.`);
if (/lorem ipsum|\[replace(?: me)?\]|todo:\s*(?:replace|write|add)/i.test(html)) errors.push("Found unresolved placeholder content.");
if (!/(ArrowRight|PageDown|keydown|deck-stage|slide-deck)/i.test(html)) errors.push("No recognizable slide navigation runtime found.");
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log(`PASS: ${slideCount} slides · ${resolve(process.cwd(), fileArg)}`);
