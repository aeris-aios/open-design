import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { parsePreviewRuntimeMessage } from '@open-design/contracts/runtime/preview-runtime';
import {
  PREVIEW_RUNTIME_BOOTSTRAP_MARKER,
  buildPreviewRuntimeBootstrap,
} from '../../src/http/preview-runtime-bootstrap.js';

const identity = {
  sessionId: 'session-1',
  documentVersion: '100:200',
};

describe('preview runtime bootstrap', () => {
  it('escapes inline identity data and rejects unbounded identities', () => {
    const bootstrap = buildPreviewRuntimeBootstrap({
      sessionId: 'session-<unsafe>',
      documentVersion: identity.documentVersion,
    });
    expect(bootstrap).toContain(PREVIEW_RUNTIME_BOOTSTRAP_MARKER);
    expect(bootstrap).toContain('session-\\u003cunsafe>');
    expect(bootstrap).not.toContain('session-<unsafe>');
    expect(() => buildPreviewRuntimeBootstrap({
      sessionId: '',
      documentVersion: identity.documentVersion,
    })).toThrow(TypeError);
    expect(() => buildPreviewRuntimeBootstrap({
      ...identity,
      availableCapabilities: ['scroll'],
      modules: [
        { capabilities: ['scroll'], source: "register('scroll',function(){return {};});" },
        { capabilities: ['scroll'], source: "register('scroll',function(){return {};});" },
      ],
    })).toThrow(/must be unique/u);
    expect(() => buildPreviewRuntimeBootstrap({
      ...identity,
      availableCapabilities: ['scroll'],
      modules: [{ capabilities: ['scroll'], source: '</script>' }],
    })).toThrow(/source is invalid/u);
  });

  it('handshakes, fences commands, and only acknowledges advertised capabilities', () => {
    const bootstrap = buildPreviewRuntimeBootstrap({
      ...identity,
      availableCapabilities: ['deck', 'snapshot'],
    });
    const source = bootstrap.replace(/^<script[^>]*>/u, '').replace(/<\/script>$/u, '');
    const messages: unknown[] = [];
    const listeners = new Map<string, Array<(event: any) => void>>();
    const parent = { postMessage: (message: unknown) => messages.push(message) };
    const context: Record<string, any> = {
      document: { readyState: 'complete' },
      parent,
      queueMicrotask: (callback: () => void) => callback(),
      requestAnimationFrame: (callback: () => void) => callback(),
      Set,
    };
    context.window = context;
    context.addEventListener = (type: string, listener: (event: any) => void) => {
      const current = listeners.get(type) ?? [];
      current.push(listener);
      listeners.set(type, current);
    };

    vm.runInNewContext(source, context);
    expect(messages.map(parsePreviewRuntimeMessage)).toEqual([
      {
        type: 'od:preview:hello',
        protocolVersion: 1,
        ...identity,
        availableCapabilities: ['snapshot', 'deck'],
      },
      { type: 'od:preview:ready', protocolVersion: 1, ...identity },
      { type: 'od:preview:visible-paint', protocolVersion: 1, ...identity },
    ]);

    const probe = (overrides: Record<string, unknown> = {}) => {
      for (const listener of listeners.get('message') ?? []) {
        listener({
          source: parent,
          data: {
            type: 'od:preview:probe',
            protocolVersion: 1,
            ...identity,
            ...overrides,
          },
        });
      }
    };
    probe({ sessionId: 'stale' });
    expect(messages).toHaveLength(3);
    probe();
    expect(messages.slice(-3).map(parsePreviewRuntimeMessage)).toEqual([
      {
        type: 'od:preview:hello',
        protocolVersion: 1,
        ...identity,
        availableCapabilities: ['snapshot', 'deck'],
      },
      { type: 'od:preview:ready', protocolVersion: 1, ...identity },
      { type: 'od:preview:visible-paint', protocolVersion: 1, ...identity },
    ]);

    const sendCommand = (overrides: Record<string, unknown> = {}) => {
      for (const listener of listeners.get('message') ?? []) {
        listener({
          source: parent,
          data: {
            type: 'od:preview:set-capabilities',
            protocolVersion: 1,
            ...identity,
            enabledCapabilities: ['edit', 'deck', 'snapshot'],
            ...overrides,
          },
        });
      }
    };
    sendCommand({ documentVersion: 'stale' });
    expect(messages).toHaveLength(6);
    sendCommand();
    expect(parsePreviewRuntimeMessage(messages.at(-1))).toEqual({
      type: 'od:preview:capabilities-applied',
      protocolVersion: 1,
      ...identity,
      enabledCapabilities: ['snapshot', 'deck'],
    });
  });

  it('falls back when background Chromium pauses animation frames', () => {
    const bootstrap = buildPreviewRuntimeBootstrap(identity);
    const source = bootstrap.replace(/^<script[^>]*>/u, '').replace(/<\/script>$/u, '');
    const messages: unknown[] = [];
    const animationFrames: Array<() => void> = [];
    const timers: Array<() => void> = [];
    let layoutReads = 0;
    const context: Record<string, any> = {
      document: {
        readyState: 'complete',
        documentElement: {
          getBoundingClientRect: () => {
            layoutReads += 1;
            return { width: 800, height: 600 };
          },
        },
      },
      parent: { postMessage: (message: unknown) => messages.push(message) },
      queueMicrotask: (callback: () => void) => callback(),
      requestAnimationFrame: (callback: () => void) => {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      setTimeout: (callback: () => void) => {
        timers.push(callback);
        return timers.length;
      },
      clearTimeout: () => {},
      Set,
    };
    context.window = context;
    context.addEventListener = () => {};

    vm.runInNewContext(source, context);

    expect(messages.map(parsePreviewRuntimeMessage)).toEqual([
      {
        type: 'od:preview:hello',
        protocolVersion: 1,
        ...identity,
        availableCapabilities: [],
      },
      { type: 'od:preview:ready', protocolVersion: 1, ...identity },
    ]);
    expect(animationFrames).toHaveLength(1);
    expect(timers).toHaveLength(1);

    timers[0]?.();
    expect(layoutReads).toBe(1);
    expect(messages.map(parsePreviewRuntimeMessage).at(-1)).toEqual({
      type: 'od:preview:visible-paint',
      protocolVersion: 1,
      ...identity,
    });

    animationFrames.shift()?.();
    animationFrames.shift()?.();
    expect(messages.filter((message) => (
      parsePreviewRuntimeMessage(message)?.type === 'od:preview:visible-paint'
    ))).toHaveLength(1);
  });

  it('captures native schedulers before authored scripts can replace them', () => {
    const bootstrap = buildPreviewRuntimeBootstrap(identity);
    const source = bootstrap.replace(/^<script[^>]*>/u, '').replace(/<\/script>$/u, '');
    const listeners = new Map<string, Array<() => void>>();
    const animationFrames: Array<() => void> = [];
    const timers: Array<() => void> = [];
    const context: Record<string, any> = {
      document: { readyState: 'loading', documentElement: null },
      parent: { postMessage: () => {} },
      requestAnimationFrame: (callback: () => void) => {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      setTimeout: (callback: () => void) => {
        timers.push(callback);
        return timers.length;
      },
      clearTimeout: () => {},
      Set,
    };
    context.window = context;
    context.addEventListener = (type: string, listener: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    };

    vm.runInNewContext(source, context);
    context.requestAnimationFrame = () => {
      throw new Error('authored requestAnimationFrame replacement');
    };
    context.setTimeout = () => {
      throw new Error('authored setTimeout replacement');
    };

    expect(() => listeners.get('DOMContentLoaded')?.[0]?.()).not.toThrow();
    expect(animationFrames).toHaveLength(1);
    expect(timers).toHaveLength(1);
  });

  it('installs capability modules once and applies idempotent enable/disable transitions', () => {
    const bootstrap = buildPreviewRuntimeBootstrap({
      ...identity,
      availableCapabilities: ['scroll'],
      modules: [{
        capabilities: ['scroll'],
        source: `register('scroll',function(){return {
          enable:function(){window.enableCount=(window.enableCount||0)+1;},
          disable:function(){window.disableCount=(window.disableCount||0)+1;}
        };});`,
      }],
    });
    const source = bootstrap.replace(/^<script[^>]*>/u, '').replace(/<\/script>$/u, '');
    const messages: unknown[] = [];
    const listeners = new Map<string, Array<(event: any) => void>>();
    const parent = { postMessage: (message: unknown) => messages.push(message) };
    const context: Record<string, any> = {
      document: { readyState: 'complete' },
      parent,
      queueMicrotask: (callback: () => void) => callback(),
      requestAnimationFrame: (callback: () => void) => callback(),
      Set,
    };
    context.window = context;
    context.addEventListener = (type: string, listener: (event: any) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    };
    vm.runInNewContext(source, context);

    const apply = (enabledCapabilities: string[]) => {
      for (const listener of listeners.get('message') ?? []) {
        listener({
          source: parent,
          data: {
            type: 'od:preview:set-capabilities',
            protocolVersion: 1,
            ...identity,
            enabledCapabilities,
          },
        });
      }
    };
    apply(['scroll']);
    apply(['scroll']);
    expect(context.enableCount).toBe(1);
    expect(context.disableCount).toBeUndefined();
    apply([]);
    apply([]);
    expect(context.enableCount).toBe(1);
    expect(context.disableCount).toBe(1);
    expect(parsePreviewRuntimeMessage(messages.at(-1))).toEqual({
      type: 'od:preview:capabilities-applied',
      protocolVersion: 1,
      ...identity,
      enabledCapabilities: [],
    });
  });
});
