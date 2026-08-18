// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ManualEditFlowCanvas,
  type ManualEditFlowInputBridge,
} from '../../src/components/ManualEditFlowCanvas';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ManualEditFlowCanvas trackpad navigation', () => {
  it('keeps blank-canvas hand panning available while Select owns the artboard', async () => {
    const onViewportChange = vi.fn();

    const { container } = render(
      <ManualEditFlowCanvas
        initialViewport={{ x: 0, y: 24, zoom: 1 }}
        zoom={1}
        artboardWidth={1280}
        onViewportChange={onViewportChange}
        onViewportChangeEnd={vi.fn()}
        interactive={false}
      />,
    );
    const flowRoot = container.querySelector<HTMLElement>('.react-flow');
    expect(flowRoot?.dataset.panOnDrag).toBe('true');
    onViewportChange.mockClear();

    fireEvent.pointerDown(flowRoot!, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(flowRoot!, { clientX: 128, clientY: 116 });
    fireEvent.pointerUp(flowRoot!);

    await waitFor(() => {
      expect(onViewportChange).toHaveBeenLastCalledWith({ x: 28, y: 40, zoom: 1 });
    });
  });

  it('matches XYFlow macOS pinch sensitivity for wheel samples bridged from the iframe', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    );
    const inputBridgeRef: { current: ManualEditFlowInputBridge | null } = { current: null };
    const onViewportChange = vi.fn();

    render(
      <ManualEditFlowCanvas
        initialViewport={{ x: 0, y: 0, zoom: 1 }}
        zoom={1}
        artboardWidth={1280}
        onViewportChange={onViewportChange}
        onViewportChangeEnd={vi.fn()}
        interactive={false}
        inputBridgeRef={inputBridgeRef}
      />,
    );
    onViewportChange.mockClear();

    act(() => {
      inputBridgeRef.current?.wheel({
        clientX: 100,
        clientY: 100,
        ctrlKey: true,
        metaKey: false,
        deltaX: 0,
        deltaY: 25,
      });
    });

    // XYFlow uses 2 ** (-deltaY * 0.002 * 10) for macOS ctrl+wheel pinch.
    expect(onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({
      zoom: 2 ** -0.5,
    }));
  });

  it('uses normal wheel sensitivity for Command-wheel bridged from the iframe', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    );
    const inputBridgeRef: { current: ManualEditFlowInputBridge | null } = { current: null };
    const onViewportChange = vi.fn();

    render(
      <ManualEditFlowCanvas
        initialViewport={{ x: 0, y: 0, zoom: 1 }}
        zoom={1}
        artboardWidth={1280}
        onViewportChange={onViewportChange}
        onViewportChangeEnd={vi.fn()}
        interactive={false}
        inputBridgeRef={inputBridgeRef}
      />,
    );
    onViewportChange.mockClear();

    act(() => {
      inputBridgeRef.current?.wheel({
        clientX: 100,
        clientY: 100,
        ctrlKey: false,
        metaKey: true,
        deltaX: 0,
        deltaY: 25,
      });
    });

    expect(onViewportChange).toHaveBeenLastCalledWith({
      x: 100 - (100 * (2 ** -0.05)),
      y: 100 - (100 * (2 ** -0.05)),
      zoom: 2 ** -0.05,
    });
  });
});
