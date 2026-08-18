// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SparklesCore } from '../../src/components/ui/SparklesCore';
import { setParticlesProviderLoadedForTests } from '../helpers/tsparticles-react-mock';

const loadParticles = vi.hoisted(() => vi.fn());

vi.mock('@tsparticles/engine', () => ({
  tsParticles: { load: loadParticles },
}));

afterEach(() => {
  setParticlesProviderLoadedForTests(false);
  loadParticles.mockReset();
  document.body.replaceChildren();
});

describe('SparklesCore lifecycle', () => {
  it('never falls back to a body canvas when its host unmounts during load', async () => {
    setParticlesProviderLoadedForTests(true);

    let resolveLoad!: (container: {
      destroyed: boolean;
      destroy: () => void;
    }) => void;
    loadParticles.mockImplementation(() => new Promise((resolve) => {
      resolveLoad = resolve;
    }));

    const view = render(<SparklesCore />);

    await waitFor(() => expect(loadParticles).toHaveBeenCalledTimes(1));
    const params = loadParticles.mock.calls[0]?.[0] as {
      element?: HTMLElement;
      id?: string;
    };
    const host = params.element;

    expect(host).toBeInstanceOf(HTMLElement);
    expect(host?.id).toBe(params.id);
    expect(host?.isConnected).toBe(true);

    view.unmount();
    expect(host?.isConnected).toBe(false);

    const generatedCanvas = document.createElement('canvas');
    generatedCanvas.dataset.generated = 'true';
    host?.append(generatedCanvas);
    const container = {
      destroyed: false,
      destroy: vi.fn(() => {
        container.destroyed = true;
        generatedCanvas.remove();
      }),
    };

    await act(async () => {
      resolveLoad(container);
      await Promise.resolve();
    });

    expect(container.destroy).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('canvas[data-generated="true"]')).toBeNull();
  });
});
