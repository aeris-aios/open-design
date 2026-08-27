// @vitest-environment jsdom

/**
 * One question form occurrence answers exactly once.
 *
 * The inline `<question-form>` submit lock used to live only in a ref owned by
 * the mounted `FormBlock`. Leaving the project (or any remount: a refresh, a
 * conversation switch, a virtualized row recycling) rebuilt that ref as
 * "never submitted", so the same occurrence could be answered a second time
 * while the first answer was still being persisted or was still draining from
 * the busy-conversation queue. That produced two identical user answers and
 * two assistant runs for one logical task — duplicate model calls, duplicate
 * billing, and a split reply with a mid-turn action bar.
 *
 * The lock is therefore keyed on the form occurrence
 * (project + conversation + assistant message + form id) and survives the
 * remount; only an explicit submit failure re-opens it.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantMessage } from '../../src/components/AssistantMessage';
import type { ChatMessage } from '../../src/types';

beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => store.delete(key),
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const FORM = [
  '<question-form id="travel_app_brief" title="Quick brief">',
  JSON.stringify({
    questions: [{ id: 'audience', label: 'Audience', type: 'text' }],
  }),
  '</question-form>',
].join('\n');

function formMessage(): ChatMessage {
  return {
    id: 'msg-form',
    role: 'assistant',
    content: FORM,
    startedAt: 1700000000,
    endedAt: 1700000005,
    events: [{ kind: 'text', text: FORM }],
  } as ChatMessage;
}

function renderForm(onSubmitQuestionForm: (text: string) => unknown): HTMLElement {
  const { container } = render(
    <AssistantMessage
      message={formMessage()}
      streaming={false}
      projectId="proj-1"
      conversationId="conv-1"
      isLast
      onSubmitQuestionForm={onSubmitQuestionForm as never}
    />,
  );
  return container;
}

function answerAndSend(container: HTMLElement, value: string): void {
  const input = container.querySelector('.qf-input');
  if (!(input instanceof HTMLInputElement)) throw new Error('expected audience input');
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
}

describe('inline question form resubmission', () => {
  it('stays locked after the component remounts with the answer not yet in history', async () => {
    const onSubmit = vi.fn(async () => true);

    answerAndSend(renderForm(onSubmit), 'Designers');
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    // Leaving the project unmounts the chat; coming back remounts the same
    // form occurrence while the answer has not surfaced in history yet.
    cleanup();
    const container = renderForm(onSubmit);

    const send = screen.getByRole('button', { name: 'Send answers' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    answerAndSend(container, 'Designers');
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('re-opens the form when the submission explicitly failed', async () => {
    const onSubmit = vi.fn(async () => false);

    answerAndSend(renderForm(onSubmit), 'Designers');
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    cleanup();
    const container = renderForm(onSubmit);
    answerAndSend(container, 'Designers');
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });
});
