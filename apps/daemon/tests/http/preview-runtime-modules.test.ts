import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildPreviewRuntimeBootstrap } from '../../src/http/preview-runtime-bootstrap.js';
import { buildScrollAndMeasurementRuntimeModule } from '../../src/http/preview-runtime-modules.js';

describe('preview runtime modules', () => {
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
