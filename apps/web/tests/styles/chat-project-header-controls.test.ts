import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(new URL('../../src/styles/chat.css', import.meta.url), 'utf8');
const composioCss = readFileSync(new URL('../../src/styles/viewer/composio.css', import.meta.url), 'utf8');

function declarations(css: string, selector: string): string {
  const escaped = selector.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Missing CSS block for ${selector}`);
  return match[1] ?? '';
}

describe('chat project header controls', () => {
  it('keeps New and history as same-sized icon controls with an 8px gap', () => {
    const actions = declarations(chatCss, '.chat-project-header-actions');
    const newButton = declarations(composioCss, '.chat-history-new');
    const newButtonHover = declarations(composioCss, '.chat-history-new:hover');
    const historyButton = declarations(chatCss, '.chat-session-trigger');

    expect(actions).toContain('gap: var(--spacing-8)');
    expect(newButton).toContain('width: 28px');
    expect(newButton).toContain('height: 28px');
    expect(newButton).toContain('padding: 0');
    expect(newButtonHover).toContain(
      'background: color-mix(in srgb, var(--bg-subtle) 84%, transparent)',
    );
    expect(newButtonHover).not.toContain('background: var(--bg-muted)');
    expect(historyButton).toContain('width: 28px');
    expect(historyButton).toContain('height: 28px');
  });

  it('removes the conversation heading and aligns row content to 8px edges', () => {
    const item = declarations(composioCss, '.chat-conv-item');
    const deleteButton = declarations(composioCss, '.chat-conv-item-del');

    expect(composioCss).not.toContain('.chat-history-menu-head');
    expect(composioCss).not.toContain('.chat-history-menu-title');
    expect(item).toContain('padding: var(--spacing-4) var(--spacing-8)');
    expect(deleteButton).toContain('position: absolute');
  });
});
