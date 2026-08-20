import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const LOCALE_SCRIPT_PATH = new URL(
  '../app/_components/locale-switcher-script.astro',
  import.meta.url,
);
const SUB_PAGE_LAYOUT_PATH = new URL(
  '../app/_components/sub-page-layout.astro',
  import.meta.url,
);

describe('locale handoff', () => {
  it('lets an explicit source locale override browser detection', async () => {
    const source = await readFile(LOCALE_SCRIPT_PATH, 'utf8');

    assert.match(source, /searchParams\.get\('od_locale'\)/);
    assert.match(source, /if \(requested[\s\S]*?requested !== current[\s\S]*?return;/);
    assert.ok(
      source.indexOf("searchParams.get('od_locale')") <
        source.indexOf("window.localStorage.getItem(STORAGE_KEY)"),
    );
  });

  it('runs locale adaptation in the head before localized body content paints', async () => {
    const layout = await readFile(SUB_PAGE_LAYOUT_PATH, 'utf8');
    const headEnd = layout.indexOf('</head>');
    const script = layout.indexOf('<LocaleSwitcherScript />');

    assert.ok(script > 0);
    assert.ok(script < headEnd);
    assert.equal(layout.indexOf('<LocaleSwitcherScript />', script + 1), -1);
  });
});
