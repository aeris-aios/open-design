// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IframeKeepAliveProvider,
  PooledIframe,
  previewIframeKeepAliveKey,
} from '../../src/components/IframeKeepAlivePool';

afterEach(cleanup);

describe('PooledIframe', () => {
  it('updates a forwarded ref without parking or reattaching the browsing context', () => {
    const firstRef = vi.fn();
    const secondRef = vi.fn();
    function Harness({ second }: { second: boolean }) {
      return (
        <IframeKeepAliveProvider>
          <PooledIframe
            ref={second ? secondRef : firstRef}
            cacheKey={previewIframeKeepAliveKey('project-1', 'index.html')}
            src="http://n-scope-0001.localhost:17456/index.html"
            title="index.html"
            data-testid="pooled-frame"
          />
        </IframeKeepAliveProvider>
      );
    }

    const { container, rerender } = render(<Harness second={false} />);
    const frame = screen.getByTestId('pooled-frame');
    const parkedHost = container.querySelector('.iframe-keep-alive-pool');
    if (!parkedHost) throw new Error('missing iframe pool host');
    const appendChild = vi.spyOn(parkedHost, 'appendChild');

    rerender(<Harness second />);

    expect(screen.getByTestId('pooled-frame')).toBe(frame);
    expect(appendChild).not.toHaveBeenCalledWith(frame);
    expect(firstRef).toHaveBeenLastCalledWith(null);
    expect(secondRef).toHaveBeenLastCalledWith(frame);
  });
});
