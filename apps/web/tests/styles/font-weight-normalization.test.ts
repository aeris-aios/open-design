import { readdirSync, readFileSync } from 'node:fs';
import { extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const styleRoots = [
  fileURLToPath(new URL('../../src', import.meta.url)),
  fileURLToPath(new URL('../../../../packages/components/src', import.meta.url)),
  fileURLToPath(new URL('../../../../apps/desktop/src', import.meta.url)),
];

function cssFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) return cssFiles(path);
    return ['.css', '.scss', '.less'].includes(extname(entry.name)) ? [path] : [];
  });
}

function withoutFontFaces(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@font-face\s*\{[^}]*\}/g, '');
}

function isForbiddenWeight(weight: number): boolean {
  const isIntermediateLow =
    weight >= 450 && weight <= 680 && weight !== 500 && weight !== 600;
  const isIntermediateHigh = weight >= 720 && weight <= 800;
  return weight === 400 || isIntermediateLow || isIntermediateHigh;
}

describe('product UI font-weight normalization', () => {
  it('uses the consolidated weight ladder outside font metadata', () => {
    const violations: string[] = [];

    for (const file of styleRoots.flatMap(cssFiles)) {
      const css = withoutFontFaces(readFileSync(file, 'utf8'));
      for (const match of css.matchAll(/font-weight\s*:\s*(\d+)\b/g)) {
        const weight = Number(match[1]);
        if (isForbiddenWeight(weight)) {
          violations.push(`${relative(repoRoot, file)}: ${weight}`);
        }
      }
      for (const match of css.matchAll(/(?:^|[;{])\s*font\s*:\s*([^;}]+)/g)) {
        const shorthand = match[1]!.trim();
        if (shorthand === 'inherit') continue;

        const explicitWeight = shorthand.match(
          /^(?:(?:normal|italic|oblique)\s+)?([1-9]00)\b/,
        );
        if (!explicitWeight) {
          violations.push(`${relative(repoRoot, file)}: font shorthand implicit 400`);
          continue;
        }

        const weight = Number(explicitWeight[1]);
        if (isForbiddenWeight(weight)) {
          violations.push(`${relative(repoRoot, file)}: font shorthand ${weight}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('preserves the real ranges registered by the bundled font files', () => {
    const baseCss = readFileSync(new URL('../../src/styles/base.css', import.meta.url), 'utf8');

    const albertFaces = [...baseCss.matchAll(/@font-face\s*\{[^}]*\}/g)].filter((match) =>
      match[0].includes('font-family: "Albert Sans"'),
    );

    expect(albertFaces).toHaveLength(2);
    for (const face of albertFaces) expect(face[0]).toMatch(/font-weight:\s*100 900;/);
    expect(baseCss).toMatch(
      /@font-face\s*\{[^}]*font-family:\s*"JiduMono Pro";[^}]*font-weight:\s*400;/s,
    );
  });
});
