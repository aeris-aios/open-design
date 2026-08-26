// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_RUNTIME_PROTOCOL_VERSION,
  type PreviewRuntimeCapability,
} from '@open-design/contracts/runtime/preview-runtime';
import {
  IframeKeepAliveProvider,
} from '../../src/components/IframeKeepAlivePool';
import {
  PreviewSessionFrames,
  type PreviewSessionNavigation,
} from '../../src/components/PreviewSessionFrames';

afterEach(cleanup);

function navigation(version: string): PreviewSessionNavigation {
  return {
    sessionId: 'scope-0001',
    documentVersion: version,
    url: `http://n-scope-0001.localhost:17456/index.html?v=${version}`,
    sandboxProfile: 'normal',
  };
}

function signal(
  frame: HTMLIFrameElement,
  document: PreviewSessionNavigation,
  type: 'od:preview:hello' | 'od:preview:capabilities-applied' | 'od:preview:ready' | 'od:preview:visible-paint',
  enabledCapabilities: readonly PreviewRuntimeCapability[] = [],
) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: {
        type,
        protocolVersion: PREVIEW_RUNTIME_PROTOCOL_VERSION,
        sessionId: document.sessionId,
        documentVersion: document.documentVersion,
        ...(type === 'od:preview:hello' ? { availableCapabilities: ['scroll', 'edit'] } : {}),
        ...(type === 'od:preview:capabilities-applied' ? { enabledCapabilities } : {}),
      },
    }));
  });
}

function settle(frame: HTMLIFrameElement, document: PreviewSessionNavigation) {
  signal(frame, document, 'od:preview:hello');
  signal(frame, document, 'od:preview:capabilities-applied');
  signal(frame, document, 'od:preview:visible-paint');
}

describe('PreviewSessionFrames', () => {
  it('keeps standby hidden until exact visible paint, then promotes the same frame', () => {
    const first = navigation('v1');
    const onCurrentFrameChange = vi.fn();
    render(
      <IframeKeepAliveProvider>
        <div className="artifact-preview-transport-stack">
          <PreviewSessionFrames
            projectId="project-1"
            fileName="index.html"
            navigation={first}
            active
            onCurrentFrameChange={onCurrentFrameChange}
          />
        </div>
      </IframeKeepAliveProvider>,
    );

    const standby = screen.getByTestId('preview-runtime-frame-standby') as HTMLIFrameElement;
    expect(standby.dataset.odActive).toBe('false');
    signal(standby, first, 'od:preview:hello');
    signal(standby, first, 'od:preview:ready');
    expect(screen.queryByTestId('preview-runtime-frame-current')).toBeNull();

    signal(standby, first, 'od:preview:visible-paint');
    expect(screen.queryByTestId('preview-runtime-frame-current')).toBeNull();
    signal(standby, first, 'od:preview:capabilities-applied');
    const current = screen.getByTestId('preview-runtime-frame-current');
    expect(current).toBe(standby);
    expect(current).toHaveAttribute('data-od-active', 'true');
    expect(onCurrentFrameChange.mock.calls.filter(([frame]) => frame === standby)).toHaveLength(1);
  });

  it('retains last-good until a replacement paints and then evicts the old version', () => {
    const first = navigation('v1');
    const second = navigation('v2');
    const view = (next: PreviewSessionNavigation) => (
      <IframeKeepAliveProvider>
        <div className="artifact-preview-transport-stack">
          <PreviewSessionFrames
            projectId="project-1"
            fileName="index.html"
            navigation={next}
            active
          />
        </div>
      </IframeKeepAliveProvider>
    );
    const { rerender } = render(view(first));
    const firstFrame = screen.getByTestId('preview-runtime-frame-standby') as HTMLIFrameElement;
    settle(firstFrame, first);

    rerender(view(second));
    expect(screen.getByTestId('preview-runtime-frame-current')).toBe(firstFrame);
    const secondFrame = screen.getByTestId('preview-runtime-frame-standby') as HTMLIFrameElement;
    expect(secondFrame).not.toBe(firstFrame);
    expect(firstFrame.dataset.odActive).toBe('true');

    settle(secondFrame, second);
    expect(screen.getByTestId('preview-runtime-frame-current')).toBe(secondFrame);
    expect(document.body.contains(firstFrame)).toBe(false);
  });

  it('suspends and resumes by visibility without changing the retained URL', () => {
    const first = navigation('v1');
    const view = (active: boolean) => (
      <IframeKeepAliveProvider>
        <PreviewSessionFrames
          projectId="project-1"
          fileName="index.html"
          navigation={first}
          active={active}
        />
      </IframeKeepAliveProvider>
    );
    const { rerender } = render(view(true));
    const frame = screen.getByTestId('preview-runtime-frame-standby') as HTMLIFrameElement;
    settle(frame, first);
    const url = frame.getAttribute('src');

    rerender(view(false));
    expect(frame).toHaveAttribute('data-od-active', 'false');
    expect(frame.getAttribute('src')).toBe(url);
    rerender(view(true));
    expect(frame).toHaveAttribute('data-od-active', 'true');
    expect(frame.getAttribute('src')).toBe(url);
  });

  it('replaces only an unpromoted standby when its navigation retry token changes', () => {
    const first = navigation('v1');
    const onStandbyFrameChange = vi.fn();
    const view = (navigationRetryToken: number) => (
      <IframeKeepAliveProvider>
        <PreviewSessionFrames
          projectId="project-1"
          fileName="index.html"
          navigation={first}
          navigationRetryToken={navigationRetryToken}
          active
          onStandbyFrameChange={onStandbyFrameChange}
        />
      </IframeKeepAliveProvider>
    );
    const { rerender } = render(view(0));
    const failed = screen.getByTestId('preview-runtime-frame-standby') as HTMLIFrameElement;
    const url = failed.getAttribute('src');

    rerender(view(1));

    const retry = screen.getByTestId('preview-runtime-frame-standby') as HTMLIFrameElement;
    expect(retry).not.toBe(failed);
    expect(retry.getAttribute('src')).toBe(url);
    expect(onStandbyFrameChange).toHaveBeenCalledWith(null);
    expect(onStandbyFrameChange).toHaveBeenLastCalledWith(retry);

    settle(retry, first);
    rerender(view(2));
    expect(screen.getByTestId('preview-runtime-frame-current')).toBe(retry);
    expect(retry.getAttribute('src')).toBe(url);
  });

  it('reattaches the same pooled browsing context and stages it for handshaking again', () => {
    const first = navigation('v1');
    function Harness({ shown }: { shown: boolean }) {
      return (
        <IframeKeepAliveProvider>
          {shown ? (
            <PreviewSessionFrames
              projectId="project-1"
              fileName="index.html"
              navigation={first}
              active
            />
          ) : null}
        </IframeKeepAliveProvider>
      );
    }
    const { rerender } = render(<Harness shown />);
    const firstFrame = screen.getByTestId('preview-runtime-frame-standby') as HTMLIFrameElement;
    settle(firstFrame, first);

    rerender(<Harness shown={false} />);
    rerender(<Harness shown />);

    const reattached = screen.getByTestId('preview-runtime-frame-standby') as HTMLIFrameElement;
    expect(reattached).toBe(firstFrame);
    settle(reattached, first);
    expect(screen.getByTestId('preview-runtime-frame-current')).toBe(firstFrame);
  });

  it('suspends the previous file session and reuses its exact frame when switching back', () => {
    const first = navigation('v1');
    const second = { ...navigation('v1'), sessionId: 'scope-0002' };
    const view = (projectId: string, fileName: string, next: PreviewSessionNavigation) => (
      <IframeKeepAliveProvider>
        <PreviewSessionFrames
          projectId={projectId}
          fileName={fileName}
          navigation={next}
          active
        />
      </IframeKeepAliveProvider>
    );
    const { rerender } = render(view('project-1', 'index.html', first));
    const oldFrame = screen.getByTestId('preview-runtime-frame-standby') as HTMLIFrameElement;
    settle(oldFrame, first);

    rerender(view('project-2', 'other.html', second));

    expect(screen.queryByTestId('preview-runtime-frame-current')).toBeNull();
    const standby = screen.getByTestId('preview-runtime-frame-standby') as HTMLIFrameElement;
    expect(standby).not.toBe(oldFrame);
    expect(standby).toHaveAttribute('src', second.url);
    settle(standby, second);

    rerender(view('project-1', 'index.html', first));

    expect(screen.queryByTestId('preview-runtime-frame-current')).toBeNull();
    const restored = screen.getByTestId('preview-runtime-frame-standby') as HTMLIFrameElement;
    expect(restored).toBe(oldFrame);
    expect(restored).toHaveAttribute('src', first.url);
    settle(restored, first);
    expect(screen.getByTestId('preview-runtime-frame-current')).toBe(oldFrame);
  });

  it('reports exact capability application for standby and retained current frames', async () => {
    const first = navigation('v1');
    const onCapabilitiesApplied = vi.fn();
    const view = (enabledCapabilities: readonly PreviewRuntimeCapability[]) => (
      <IframeKeepAliveProvider>
        <PreviewSessionFrames
          projectId="project-1"
          fileName="index.html"
          navigation={first}
          enabledCapabilities={enabledCapabilities}
          active
          onCapabilitiesApplied={onCapabilitiesApplied}
        />
      </IframeKeepAliveProvider>
    );
    const { rerender } = render(view(['edit']));
    const frame = screen.getByTestId('preview-runtime-frame-standby') as HTMLIFrameElement;
    const target = frame.contentWindow!;
    const postMessage = vi.spyOn(target, 'postMessage');

    signal(frame, first, 'od:preview:hello');
    signal(frame, first, 'od:preview:capabilities-applied', ['edit']);
    expect(onCapabilitiesApplied).toHaveBeenLastCalledWith(frame, ['edit']);
    signal(frame, first, 'od:preview:visible-paint');

    postMessage.mockClear();
    await act(async () => {
      rerender(view(['scroll']));
      await Promise.resolve();
    });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'od:preview:set-capabilities',
      enabledCapabilities: ['scroll'],
    }), '*');
    signal(frame, first, 'od:preview:capabilities-applied', ['scroll']);
    expect(onCapabilitiesApplied).toHaveBeenLastCalledWith(frame, ['scroll']);
    expect(screen.getByTestId('preview-runtime-frame-current')).toBe(frame);
  });
});
