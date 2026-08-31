// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  captureElementScrollAnchor,
  scrollTopForElementScrollAnchor,
} from '../../../src/runtime/chat/element-scroll-anchor';

function rect(top: number): DOMRect {
  return {
    top,
    bottom: top + 30,
    left: 0,
    right: 200,
    width: 200,
    height: 30,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('in-chat element scroll anchor', () => {
  it('keeps a stepped form footer at the same viewport position after Next changes height', () => {
    const container = document.createElement('div');
    const form = document.createElement('div');
    form.dataset.formId = 'brief';
    const footer = document.createElement('div');
    footer.dataset.chatScrollAnchor = 'question-footer';
    footer.getBoundingClientRect = () => rect(310);
    const next = document.createElement('button');
    next.dataset.chatPreserveScrollAnchor = 'question-footer';
    footer.append(next);
    form.append(footer);
    container.append(form);
    document.body.append(container);
    container.scrollTop = 700;

    const snapshot = captureElementScrollAnchor(container, next);
    expect(snapshot).not.toBeNull();
    footer.getBoundingClientRect = () => rect(490);

    expect(scrollTopForElementScrollAnchor(container, snapshot!)).toBe(880);
    container.remove();
  });

  it('finds the replacement own-answer row instead of retaining a detached node', () => {
    const container = document.createElement('div');
    const form = document.createElement('div');
    form.dataset.formId = 'brief';
    const collapsed = document.createElement('button');
    collapsed.dataset.chatScrollAnchor = 'question-own:tone';
    collapsed.dataset.chatPreserveScrollAnchor = 'question-own:tone';
    collapsed.getBoundingClientRect = () => rect(220);
    form.append(collapsed);
    container.append(form);
    document.body.append(container);
    container.scrollTop = 500;

    const snapshot = captureElementScrollAnchor(container, collapsed);
    const expanded = document.createElement('div');
    expanded.dataset.chatScrollAnchor = 'question-own:tone';
    expanded.getBoundingClientRect = () => rect(260);
    collapsed.replaceWith(expanded);

    expect(scrollTopForElementScrollAnchor(container, snapshot!)).toBe(540);
    container.remove();
  });
});
