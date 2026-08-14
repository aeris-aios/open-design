import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * The old illustrated "Start from a template… / …or create a blank project"
 * rail was removed in #5517. Home now offers compact type pills above the
 * composer plus the footer picker; this helper drives the latter, whose
 * `home-hero-template-trigger` opens a bounded list (`home-hero-template-menu`)
 * with stable `home-hero-template-wedge-<chipId>` row ids.
 *
 * These helpers are the single place e2e encodes that entry point, so the next
 * time the picker's shape changes only this file moves.
 */

/** Open the template list (idempotent). Returns the menu locator. */
export async function openHomeTemplateMenu(page: Page): Promise<Locator> {
  const menu = page.getByTestId('home-hero-template-menu');
  if ((await menu.count()) > 0) return menu;
  await page.getByTestId('home-hero-template-trigger').click();
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * Select a template by `HomeHeroChip` id (see
 * `apps/web/src/components/home-hero/chips.ts`) — `deck`, `prototype`,
 * `wireframe`, `mobile`, `document`, `web-clone`, `webgl`, `hyperframes`,
 * `live-artifact`, `image`, `video`, `audio`.
 *
 * Only `apply-scenario` chips are offered as wedges. The action chips that used
 * to share the rail moved to their own surfaces and are NOT reachable here:
 * Brand Kit → the composer design-system picker's Create button
 * (`project-ds-picker-create`), plugin authoring → the Extensions page
 * (`plugins-create-button`), Figma import → the composer plus menu.
 */
export async function pickHomeTemplate(page: Page, chipId: string): Promise<void> {
  await openHomeTemplateMenu(page);
  const wedge = page.getByTestId(`home-hero-template-wedge-${chipId}`);
  await expect(wedge).toBeVisible();
  await wedge.click();
  // Confirming a row closes the menu and puts the chosen label on the pill —
  // clearing a type was removed, so the label is the observable "it is set".
  await expect(page.getByTestId('home-hero-template-menu')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-template-picker')).toHaveClass(/has-selection/);
}
