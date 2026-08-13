import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// The workspace file-tab strip was removed, so Design Files has no tab to
// click and no aria-selected to read: the panel is reached with the browser
// tab shortcut for the first workspace tab (⌘/Ctrl+1, which is always Design
// Files) and "active" simply means the panel is on screen. These helpers keep
// their historical names so the many existing call sites read the same.
export async function openAllProjectFiles(page: Page): Promise<void> {
  // FileWorkspace accepts either primary modifier, so one key press covers
  // every platform the suite runs on.
  await page.keyboard.press('Control+1');
  await expectAllProjectFilesActive(page);
}

export async function expectAllProjectFilesActive(page: Page): Promise<void> {
  await expect(page.getByTestId('design-files-panel')).toBeVisible();
}

export async function expectAllProjectFilesInactive(page: Page): Promise<void> {
  await expect(page.getByTestId('design-files-panel')).toBeHidden();
}

export async function clickDeckNextSlide(page: Page): Promise<void> {
  await revealDeckNavigation(page);
  const button = page.locator('button[aria-label="Next slide"]:visible');
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
}

export async function clickDeckPreviousSlide(page: Page): Promise<void> {
  await revealDeckNavigation(page);
  const button = page.locator('button[aria-label="Previous slide"]:visible');
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
}

async function revealDeckNavigation(page: Page): Promise<void> {
  const canvas = page.getByTestId('comment-preview-canvas');
  if (await canvas.isVisible().catch(() => false)) {
    await canvas.hover();
  }
}
