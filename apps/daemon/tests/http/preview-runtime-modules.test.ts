import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildPreviewRuntimeBootstrap } from '../../src/http/preview-runtime-bootstrap.js';
import {
  buildInstalledScriptRuntimeModule,
  buildLazyScriptRuntimeModule,
  buildScrollAndMeasurementRuntimeModule,
  buildTweaksRuntimeModule,
} from '../../src/http/preview-runtime-modules.js';

describe('preview runtime modules', () => {
  it('prevents Tweaks panel flash and activates host control only after negotiation', async () => {
    const source = buildPreviewRuntimeBootstrap({
      sessionId: 'session-1',
      documentVersion: 'version-1',
      availableCapabilities: ['tweaks'],
      modules: [buildTweaksRuntimeModule()],
    }).replace(/^<script[^>]*>/u, '').replace(/<\/script>$/u, '');
    const posted: any[] = [];
    const listeners = new Map<string, Array<(event: any) => void>>();
    const rootAttributes = new Set<string>();
    const panelClasses = new Set<string>();
    const panel = {
      classList: {
        contains: (name: string) => panelClasses.has(name),
        toggle: (name: string, force: boolean) => force ? panelClasses.add(name) : panelClasses.delete(name),
      },
    };
    const documentElement = {
      setAttribute: (name: string) => rootAttributes.add(name),
      toggleAttribute: (name: string, force: boolean) => force ? rootAttributes.add(name) : rootAttributes.delete(name),
    };
    const head = { appendChild: () => {} };
    const addListener = (type: string, listener: (event: any) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    };
    const document = {
      readyState: 'complete',
      documentElement,
      head,
      querySelector: (selector: string) => selector === '.tw-panel' ? panel : null,
      createElement: () => ({ setAttribute: () => {}, textContent: '' }),
      addEventListener: addListener,
    };
    const parent = { postMessage: (message: unknown) => posted.push(message) };
    const context: Record<string, any> = {
      document,
      parent,
      MutationObserver: class { observe() {} },
      Promise,
      Set,
      queueMicrotask: (callback: () => void) => callback(),
      requestAnimationFrame: (callback: () => void) => callback(),
      addEventListener: addListener,
    };
    context.window = context;
    vm.runInNewContext(source, context);
    expect(rootAttributes.has('data-od-tweaks-hidden')).toBe(false);
    expect(posted.some((message) => message.type === 'od:tweaks-available')).toBe(false);

    const dispatch = (data: Record<string, unknown>) => {
      for (const listener of listeners.get('message') ?? []) listener({ source: parent, data });
    };
    dispatch({
      type: 'od:preview:set-capabilities',
      protocolVersion: 1,
      sessionId: 'session-1',
      documentVersion: 'version-1',
      enabledCapabilities: ['tweaks'],
    });
    expect(posted).toContainEqual(expect.objectContaining({
      type: 'od:tweaks-available',
      available: true,
    }));
    expect(posted).toContainEqual(expect.objectContaining({
      type: 'od:tweaks-panel-state',
      visible: true,
    }));

    dispatch({ type: 'od:tweaks-panel-visible', visible: false });
    await Promise.resolve();
    expect(panelClasses.has('tw-hidden')).toBe(true);
    expect(rootAttributes.has('data-od-tweaks-hidden')).toBe(true);
  });

  it('installs passive scripts immediately and interaction scripts only on first enable', () => {
    const modules = [
      buildInstalledScriptRuntimeModule(
        'observability',
        '<script data-passive>window.passiveInstalls=(window.passiveInstalls||0)+1;</script>',
        'data-passive',
      ),
      buildLazyScriptRuntimeModule(
        'snapshot',
        '<script data-lazy>window.lazyInstalls=(window.lazyInstalls||0)+1;</script>',
        'data-lazy',
      ),
    ];
    const source = buildPreviewRuntimeBootstrap({
      sessionId: 'session-1',
      documentVersion: 'version-1',
      availableCapabilities: ['snapshot', 'observability'],
      modules,
    }).replace(/^<script[^>]*>/u, '').replace(/<\/script>$/u, '');
    const listeners = new Map<string, Array<(event: any) => void>>();
    const parent = { postMessage: () => {} };
    const context: Record<string, any> = {
      document: { readyState: 'complete' },
      parent,
      Set,
      queueMicrotask: (callback: () => void) => callback(),
      requestAnimationFrame: (callback: () => void) => callback(),
    };
    context.window = context;
    context.addEventListener = (type: string, listener: (event: any) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    };
    vm.runInNewContext(source, context);
    expect(context.passiveInstalls).toBe(1);
    expect(context.lazyInstalls).toBeUndefined();

    const command = (enabledCapabilities: string[]) => {
      for (const listener of listeners.get('message') ?? []) {
        listener({
          source: parent,
          data: {
            type: 'od:preview:set-capabilities',
            protocolVersion: 1,
            sessionId: 'session-1',
            documentVersion: 'version-1',
            enabledCapabilities,
          },
        });
      }
    };
    command(['snapshot', 'observability']);
    command([]);
    command(['snapshot', 'observability']);
    expect(context.lazyInstalls).toBe(1);
    expect(context.passiveInstalls).toBe(1);
  });

  it('keeps scroll and measurement dormant until independently enabled', () => {
    const source = buildPreviewRuntimeBootstrap({
      sessionId: 'session-1',
      documentVersion: 'version-1',
      availableCapabilities: ['content_measurement', 'scroll'],
      modules: [buildScrollAndMeasurementRuntimeModule()],
    }).replace(/^<script[^>]*>/u, '').replace(/<\/script>$/u, '');
    const posted: any[] = [];
    const listeners = new Map<string, Array<(event: any) => void>>();
    const frame = {
      scrollLeft: 4,
      scrollTop: 7,
      scrollWidth: 640,
      clientWidth: 320,
      scrollTo(left: number, top: number) { this.scrollLeft = left; this.scrollTop = top; },
      scrollBy({ left, top }: { left: number; top: number }) {
        this.scrollLeft += left;
        this.scrollTop += top;
      },
    };
    const parent = { postMessage: (message: unknown) => posted.push(message) };
    const addListener = (type: string, listener: (event: any) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    };
    const document = {
      readyState: 'complete',
      documentElement: frame,
      body: frame,
      scrollingElement: frame,
      fonts: { ready: Promise.resolve() },
      querySelector: () => null,
      addEventListener: addListener,
    };
    const context: Record<string, any> = {
      document,
      parent,
      location: { search: '?odPreviewEpoch=epoch-1' },
      URLSearchParams,
      Number,
      Math,
      Set,
      setTimeout: (callback: () => void) => callback(),
      queueMicrotask: (callback: () => void) => callback(),
      requestAnimationFrame: (callback: () => void) => callback(),
      addEventListener: addListener,
    };
    context.window = context;
    vm.runInNewContext(source, context);

    const dispatch = (data: Record<string, unknown>) => {
      for (const listener of listeners.get('message') ?? []) listener({ source: parent, data });
    };
    const command = (enabledCapabilities: string[]) => dispatch({
      type: 'od:preview:set-capabilities',
      protocolVersion: 1,
      sessionId: 'session-1',
      documentVersion: 'version-1',
      enabledCapabilities,
    });

    dispatch({ type: 'od:preview-scroll-by', left: 10, top: 20 });
    expect(frame.scrollLeft).toBe(4);
    command(['scroll']);
    expect(posted.some((message) => message.type === 'od:preview-scroll-request')).toBe(true);
    dispatch({ type: 'od:preview-scroll-by', left: 10, top: 20 });
    expect(frame.scrollLeft).toBe(14);
    expect(frame.scrollTop).toBe(27);

    dispatch({
      type: 'od:preview-content-size-request',
      measurementId: 'measure-before-enable',
      generation: 'generation-1',
    });
    expect(posted.some((message) => message.measurementId === 'measure-before-enable')).toBe(false);
    command(['scroll', 'content_measurement']);
    dispatch({
      type: 'od:preview-content-size-request',
      measurementId: 'measure-enabled',
      generation: 'generation-1',
    });
    expect(posted).toContainEqual(expect.objectContaining({
      type: 'od:preview-content-size',
      measurementId: 'measure-enabled',
      documentEpoch: 'epoch-1',
      scrollWidth: 640,
      clientWidth: 320,
    }));

    command([]);
    dispatch({ type: 'od:preview-scroll-by', left: 10, top: 20 });
    expect(frame.scrollLeft).toBe(14);
  });
});
