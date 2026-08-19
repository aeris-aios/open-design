import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const headerSource = readFileSync(
  new URL('../app/_components/header.tsx', import.meta.url),
  'utf8',
);
const stylesSource = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('community entry moves into the drawer without overflowing long localized labels', () => {
  assert.match(
    headerSource,
    /<li className='nav-community-mobile-entry'>[\s\S]*?className='nav-community-mobile-cta'[\s\S]*?className='nav-community-mobile-benefits'/,
  );
  assert.match(headerSource, /cta: 'Приєднатися до Discord'/);
  assert.match(stylesSource, /\.nav-community-mobile-entry\s*\{\s*display:\s*none;/);
  assert.match(
    stylesSource,
    /@media \(max-width: 1080px\)[\s\S]*?\.nav-side \.nav-community-entry\s*\{\s*display:\s*none;\s*\}[\s\S]*?\.nav-links \.nav-community-mobile-entry\s*\{[^}]*display:\s*grid;/,
  );
  assert.match(
    stylesSource,
    /\.nav-links \.nav-community-mobile-cta\s*\{[^}]*max-width:\s*100%;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s,
  );
});
