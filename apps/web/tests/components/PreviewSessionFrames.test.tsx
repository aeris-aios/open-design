// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_RUNTIME_PROTOCOL_VERSION } from '@open-design/contracts/runtime/preview-runtime';
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
  };
}

function signal(
  frame: HTMLIFrameElement,
  document: PreviewSessionNavigation,
  type: 'od:preview:ready' | 'od:preview:visible-paint',
) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: {
        type,
        protocolVersion: PREVIEW_RUNTIME_PROTOCOL_VERSION,
        sessionId: document.sessionId,
        documentVersion: document.documentVersion,
      },
    }));
  });
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
    signal(standby, first, 'od:preview:ready');
    expect(screen.queryByTestId('preview-runtime-frame-current')).toBeNull();

    signal(standby, first, 'od:preview:visible-paint');
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
    signal(firstFrame, first, 'od:preview:visible-paint');

    rerender(view(second));
    expect(screen.getByTestId('preview-runtime-frame-current')).toBe(firstFrame);
    const secondFrame = screen.getByTestId('preview-runtime-frame-standby') as HTMLIFrameElement;
    expect(secondFrame).not.toBe(firstFrame);
    expect(firstFrame.dataset.odActive).toBe('true');

    signal(secondFrame, second, 'od:preview:visible-paint');
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
    signal(frame, first, 'od:preview:visible-paint');
    const url = frame.getAttribute('src');

    rerender(view(false));
    expect(frame).toHaveAttribute('data-od-active', 'false');
    expect(frame.getAttribute('src')).toBe(url);
    rerender(view(true));
    expect(frame).toHaveAttribute('data-od-active', 'true');
    expect(frame.getAttribute('src')).toBe(url);
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
    signal(firstFrame, first, 'od:preview:visible-paint');

    rerender(<Harness shown={false} />);
    rerender(<Harness shown />);

    const reattached = screen.getByTestId('preview-runtime-frame-standby') as HTMLIFrameElement;
    expect(reattached).toBe(firstFrame);
    signal(reattached, first, 'od:preview:visible-paint');
    expect(screen.getByTestId('preview-runtime-frame-current')).toBe(firstFrame);
  });

  it('drops the previous file session when one component instance changes projects', () => {
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
    signal(oldFrame, first, 'od:preview:visible-paint');

    rerender(view('project-2', 'other.html', second));

    expect(screen.queryByTestId('preview-runtime-frame-current')).toBeNull();
    const standby = screen.getByTestId('preview-runtime-frame-standby');
    expect(standby).not.toBe(oldFrame);
    expect(standby).toHaveAttribute('src', second.url);
  });
});
