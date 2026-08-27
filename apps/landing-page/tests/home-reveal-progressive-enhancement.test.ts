import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const stylesSource = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const homepageSource = readFileSync(new URL('../app/pages/index.astro', import.meta.url), 'utf8');
const sharedEnhancerSource = readFileSync(
  new URL('../app/_components/home-enhancer.astro', import.meta.url),
  'utf8',
);
const canonicalTemplateSource = readFileSync(
  new URL('../../../design-templates/open-design-landing/example.html', import.meta.url),
  'utf8',
);
const templateStylesSource = readFileSync(
  new URL('../../../design-templates/open-design-landing/styles.css', import.meta.url),
  'utf8',
);
const templateComposerSource = readFileSync(
  new URL('../../../design-templates/open-design-landing/scripts/compose.ts', import.meta.url),
  'utf8',
);

test('keeps reveal content visible until the animation observer is ready', () => {
  assert.match(
    stylesSource,
    /\[data-reveal\]\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?translate:\s*0 0;[\s\S]*?\}/,
  );
  assert.match(
    stylesSource,
    /\.reveal-ready \[data-reveal\]:not\(\[data-revealed='true'\]\)\s*\{[\s\S]*?opacity:\s*0;/,
  );
  assert.match(
    stylesSource,
    /\.blur-word\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?filter:\s*none;[\s\S]*?transform:\s*none;/,
  );
  assert.match(stylesSource, /\.reveal-ready \.blur-word\s*\{[\s\S]*?opacity:\s*0;/);
});

test('preserves the hero and mobile CTA reveal exceptions after readiness', () => {
  assert.match(
    stylesSource,
    /\.reveal-ready \.hero h1\.hero-title\[data-reveal\]\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?translate:\s*0 0;/,
  );
  assert.match(
    stylesSource,
    /@media \(max-width:\s*720px\)[\s\S]*?\.reveal-ready \.cta-window\[data-reveal\]:not\(\[data-revealed='true'\]\)\s*\{\s*translate:\s*0 0;/,
  );
});

test('keeps the canonical design template in the progressive-enhancement contract', () => {
  assert.match(
    templateStylesSource,
    /\[data-reveal\]\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?translate:\s*0 0;[\s\S]*?\}/,
  );
  assert.match(
    templateStylesSource,
    /\.reveal-ready \[data-reveal\]:not\(\[data-revealed='true'\]\)\s*\{[\s\S]*?opacity:\s*0;/,
  );
  assert.match(
    templateComposerSource,
    /observer\.observe\(elements\[j\]\)[\s\S]*?classList\.add\('reveal-ready'\)/,
  );
  assert.match(
    templateComposerSource,
    /catch \(error\)[\s\S]*?classList\.remove\('reveal-ready'\)/,
  );
  assert.match(
    canonicalTemplateSource,
    /\[data-reveal\]\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?translate:\s*0 0;[\s\S]*?\}/,
  );
  assert.match(
    canonicalTemplateSource,
    /\.reveal-ready \[data-reveal\]:not\(\[data-revealed='true'\]\)\s*\{[\s\S]*?opacity:\s*0;/,
  );
  const observeIndex = canonicalTemplateSource.indexOf('observer.observe(elements[j])');
  const readyIndex = canonicalTemplateSource.indexOf("classList.add('reveal-ready')");

  assert.notEqual(observeIndex, -1, 'canonical template does not bind reveal elements');
  assert.ok(readyIndex > observeIndex, 'canonical template enables hidden states before binding');
  assert.match(
    canonicalTemplateSource,
    /catch \(error\)[\s\S]*?classList\.remove\('reveal-ready'\)/,
  );
});

for (const [name, source] of [
  ['canonical homepage', homepageSource],
  ['shared homepage enhancer', sharedEnhancerSource],
] as const) {
  test(`${name} enables reveal styles only after observer binding succeeds`, () => {
    const observeIndex = source.indexOf('observer.observe(el)');
    const readyIndex = source.indexOf("classList.add('reveal-ready')");

    assert.notEqual(observeIndex, -1, `${name} does not bind reveal elements`);
    assert.ok(readyIndex > observeIndex, `${name} enables hidden states before observer binding`);
    assert.match(source, /catch \(error\)[\s\S]*?classList\.remove\('reveal-ready'\)/);
  });
}
