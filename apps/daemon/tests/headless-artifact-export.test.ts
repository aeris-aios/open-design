import { describe, expect, it } from 'vitest';

import {
  clampExportHeight,
  clampExportWidth,
  imageExtensionFor,
  imageMimeFor,
  parseMeasuredArtifactSize,
} from '../src/headless-artifact-export.js';
import { normalizeImageExportBody } from '../src/import-export-routes.js';

describe('headless image format handoff', () => {
  it('names the output file so Chromium picks the requested encoder', () => {
    // `--screenshot=<file>` infers the encoder from the extension. The
    // requested format therefore has to reach the OUTPUT PATH — this is the
    // mapping that made `imageFormat: 'jpeg'` come back as image/png.
    expect(imageExtensionFor('jpeg')).toBe('jpg');
    expect(imageMimeFor('jpeg')).toBe('image/jpeg');
  });

  it('defaults to PNG when no format is requested', () => {
    expect(imageExtensionFor(undefined)).toBe('png');
    expect(imageMimeFor(undefined)).toBe('image/png');
    expect(imageExtensionFor('png')).toBe('png');
    expect(imageMimeFor('png')).toBe('image/png');
  });
});

describe('normalizeImageExportBody', () => {
  it('reads a body `format` as the image encoder on the image route', () => {
    // Regression: POST /export/image dropped `format` entirely (only
    // `imageFormat` was read), so `{fileName, format: 'jpeg'}` rendered and
    // returned image/png. The route's export KIND is already "image", so a
    // body `format` can only be naming the encoder.
    expect(normalizeImageExportBody({ fileName: 'a.html', format: 'jpeg' }))
      .toEqual({ fileName: 'a.html', imageFormat: 'jpeg' });
  });

  it('lets an explicit imageFormat win and leaves other bodies alone', () => {
    expect(normalizeImageExportBody({ fileName: 'a.html', format: 'jpeg', imageFormat: 'png' }))
      .toEqual({ fileName: 'a.html', format: 'jpeg', imageFormat: 'png' });
    expect(normalizeImageExportBody({ fileName: 'a.html' })).toEqual({ fileName: 'a.html' });
    expect(normalizeImageExportBody(null)).toBeNull();
    expect(normalizeImageExportBody(undefined)).toBeUndefined();
  });
});

describe('parseMeasuredArtifactSize', () => {
  it('reads the artifact canvas the measure pass stamped on <html>', () => {
    // A 1080x1080 square used to be cropped by the fixed 1440x900 render
    // viewport; the measure pass reports the artifact's own canvas instead.
    expect(parseMeasuredArtifactSize('<html data-od-export-size="1080x1080"><body></body></html>'))
      .toEqual({ width: 1080, height: 1080 });
  });

  it('clamps an absurd measurement instead of handing it to Chromium', () => {
    expect(parseMeasuredArtifactSize('<html data-od-export-size="99999x99999">'))
      .toEqual({ width: clampExportWidth(99999), height: clampExportHeight(99999) });
  });

  it('returns null when the stamp is missing or degenerate so defaults apply', () => {
    expect(parseMeasuredArtifactSize('<html><body>no stamp</body></html>')).toBeNull();
    expect(parseMeasuredArtifactSize('<html data-od-export-size="0x0">')).toBeNull();
  });
});
