import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routinesCss = readFileSync(
  new URL('../../src/styles/viewer/routines.css', import.meta.url),
  'utf8',
);
const homeHeroCss = readFileSync(
  new URL('../../src/styles/home/home-hero.css', import.meta.url),
  'utf8',
);

describe('global error toast chrome alignment', () => {
  it('centres both error-tone and alert-role top toasts on the header avatar', () => {
    const rule = routinesCss.match(
      /\.od-toast\.placement-top:where\(\.tone-error, \[role='alert'\]\)\s*\{([^}]*)\}/,
    );

    expect(rule?.[1]).toMatch(/top:\s*var\(--spacing-4\);/);
    expect(rule?.[1]).toMatch(/z-index:\s*1900;/);
  });

  it('keeps the urgent selector weak enough for pane-local toast anchors to reset', () => {
    expect(routinesCss).toContain(".od-toast.placement-top:where(.tone-error, [role='alert'])");
    expect(routinesCss).toMatch(
      /\.workspace-toast-anchor \.od-toast\s*\{[^}]*inset:\s*auto;/s,
    );
    expect(routinesCss).toMatch(
      /\.design-systems-toast-anchor \.od-toast\s*\{[^}]*inset:\s*auto;/s,
    );
  });

  it('keeps the Home composer error on the same avatar centre line', () => {
    const rule = homeHeroCss.match(/\.home-hero__error\s*\{([^}]*)\}/);

    expect(rule?.[1]).toMatch(/top:\s*var\(--spacing-4\);/);
  });

  it('keeps ordinary top-placement feedback below the header', () => {
    const rule = routinesCss.match(/\.od-toast\.placement-top\s*\{([^}]*)\}/);

    expect(rule?.[1]).toMatch(/top:\s*64px;/);
  });
});
