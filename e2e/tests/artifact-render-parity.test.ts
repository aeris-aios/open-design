import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';

import {
  classifyPixelParity,
  comparePngBuffers,
} from '../lib/playwright/artifact-render-parity.ts';

describe('artifact render parity', () => {
  it('reports byte-identical pixels as exact', () => {
    const png = solidPng(3, 2, [20, 40, 60, 255]);
    const comparison = comparePngBuffers(png, png);

    expect(comparison.exactDiffPixels).toBe(0);
    expect(comparison.perceptualDiffPixels).toBe(0);
    expect(classifyPixelParity({
      comparison,
      actualSelfDriftRatio: 0,
      expectedSelfDriftRatio: 0,
      maxPerceptualDiffRatio: 0.001,
      maxSelfDriftRatio: 0.001,
    })).toBe('exact');
  });

  it('counts changed pixels and emits a same-sized diff', () => {
    const before = solidPng(2, 2, [255, 255, 255, 255]);
    const after = solidPng(2, 2, [255, 255, 255, 255]);
    const decoded = PNG.sync.read(after);
    decoded.data.set([0, 0, 0, 255], 0);

    const comparison = comparePngBuffers(before, PNG.sync.write(decoded));

    expect(comparison.exactDiffPixels).toBe(1);
    expect(comparison.perceptualDiffPixels).toBe(1);
    expect(comparison.perceptualDiffRatio).toBe(0.25);
    const diff = PNG.sync.read(comparison.diffPng);
    expect([diff.width, diff.height]).toEqual([2, 2]);
  });

  it('treats a viewport-size change as a measurable pixel difference', () => {
    const smaller = solidPng(2, 2, [255, 255, 255, 255]);
    const taller = solidPng(2, 3, [255, 255, 255, 255]);

    const comparison = comparePngBuffers(smaller, taller);

    expect(comparison.actualHeight).toBe(2);
    expect(comparison.expectedHeight).toBe(3);
    expect(comparison.perceptualDiffPixels).toBe(2);
    expect(comparison.perceptualDiffRatio).toBeCloseTo(1 / 3);
  });

  it('does not call two dynamic captures a transport regression', () => {
    expect(classifyPixelParity({
      comparison: { exactDiffPixels: 100, perceptualDiffRatio: 0.25 },
      actualSelfDriftRatio: 0.02,
      expectedSelfDriftRatio: 0,
      maxPerceptualDiffRatio: 0.001,
      maxSelfDriftRatio: 0.001,
    })).toBe('unstable');
  });
});

function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data.set(rgba, offset);
  }
  return PNG.sync.write(png);
}
