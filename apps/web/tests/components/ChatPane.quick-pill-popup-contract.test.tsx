// @vitest-environment jsdom

// The composer keeps Design Toolbox discoverable inside the "+" menu, and
// nothing regresses into persistent quick pills above the input. Plugins were
// removed from the "+" menu entirely (user request): they live on their own
// surfaces (插件 quick pill flow / plugins home), so the menu must not offer
// a duplicate row.

if (typeof HTMLElement.prototype.scrollTo !== 'function') {
  HTMLElement.prototype.scrollTo = function () {};
}

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';

afterEach(() => {
  cleanup();
});

describe('composer resource discovery', () => {
  it('keeps Design Toolbox in the plus menu without a Plugins row or persistent quick pills', () => {
    render(
      <ChatPane
        messages={[]}
        streaming={false}
        error={null}
        projectId="project-1"
        projectFiles={[]}
        onEnsureProject={async () => 'project-1'}
        onSend={() => {}}
        onStop={() => {}}
        conversations={[]}
        activeConversationId={null}
        onSelectConversation={() => {}}
        onDeleteConversation={() => {}}
      />,
    );

    expect(screen.queryByTestId('composer-quick-pills')).toBeNull();

    fireEvent.click(screen.getByTestId('chat-plus-trigger'));

    expect(screen.queryByTestId('composer-plus-plugins')).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Design Toolbox|设计百宝箱/i })).toBeTruthy();
  });
});
