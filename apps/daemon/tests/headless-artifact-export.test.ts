import { describe, expect, it } from 'vitest';

import {
  clampExportHeight,
  clampExportWidth,
  imageExtensionFor,
  imageMimeFor,
  injectAtHeadEnd,
  parseMeasuredArtifactSize,
  pdfPageStyleFor,
  poppinsFontFaceStyle,
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
      .toEqual({ artboard: false, width: 1080, height: 1080 });
  });

  it('reports whether the measured box is the artifact\'s artboard', () => {
    // `artboard` is what gates the capture normalisation: only a document with
    // a single dominant canvas gets its page frame stripped and the window
    // parked on the design. A multi-block page must stay in page mode.
    expect(parseMeasuredArtifactSize(
      '<html data-od-export-size="1080x1080" data-od-export-mode="artboard"><body></body></html>',
    )).toEqual({ artboard: true, width: 1080, height: 1080 });
    expect(parseMeasuredArtifactSize(
      '<html data-od-export-size="1440x2200" data-od-export-mode="page"><body></body></html>',
    )).toEqual({ artboard: false, width: 1440, height: 2200 });
  });

  it('clamps an absurd measurement instead of handing it to Chromium', () => {
    expect(parseMeasuredArtifactSize('<html data-od-export-size="99999x99999">'))
      .toEqual({ artboard: false, width: clampExportWidth(99999), height: clampExportHeight(99999) });
  });

  it('returns null when the stamp is missing or degenerate so defaults apply', () => {
    expect(parseMeasuredArtifactSize('<html><body>no stamp</body></html>')).toBeNull();
    expect(parseMeasuredArtifactSize('<html data-od-export-size="0x0">')).toBeNull();
  });
});

describe('pdfPageStyleFor', () => {
  it('prints the artboard at its own size instead of US Letter', () => {
    // A 1080x1080 social post used to come back as a 612x792pt Letter page
    // with the art clipped off the right edge.
    const style = pdfPageStyleFor({ width: 1080, height: 1080 });
    expect(style).toContain('@page{size:11.2500in 11.2500in;margin:0}');
    expect(pdfPageStyleFor({ width: 760, height: 984 }))
      .toContain('@page{size:7.9167in 10.2500in;margin:0}');
  });

  it('forces backgrounds to print so the design is not flattened to white', () => {
    expect(pdfPageStyleFor({ width: 1080, height: 1080 })).toContain('print-color-adjust:exact');
  });

  it('leaves a long scrolling artboard on Chromium\'s own pagination', () => {
    // One 680x9000 page is not a usable PDF; a document that tall is a
    // scrolling read, so it keeps paginated Letter output.
    expect(pdfPageStyleFor({ width: 680, height: 9000 })).toBeNull();
    // PDF's own page box tops out at 200in.
    expect(pdfPageStyleFor({ width: 40_000, height: 40_000 })).toBeNull();
    expect(pdfPageStyleFor({ width: 0, height: 0 })).toBeNull();
  });
});

describe('brand typeface injection', () => {
  it('embeds all four Poppins weights as data URIs', () => {
    // Chromium in the container has no Poppins installed, so an artifact that
    // merely NAMES the family rendered in Noto Sans. Data URIs mean no network
    // and no CORS at render time.
    const style = poppinsFontFaceStyle();
    expect(style).not.toBeNull();
    for (const weight of [400, 500, 600, 700]) {
      expect(style).toContain(`font-weight:${weight}`);
    }
    expect(style?.match(/data:font\/woff2;base64,/g)).toHaveLength(4);
    // It must only PROVIDE the family — never impose it on an artifact that
    // deliberately chose a different typeface.
    expect(style).not.toContain('font-family:"Poppins"}');
    expect(style?.includes('*{')).toBe(false);
  });

  it('splices into the end of head so a broken author @font-face cannot win', () => {
    expect(injectAtHeadEnd('<html><head><style>a{}</style></head><body>x</body></html>', '<i>'))
      .toBe('<html><head><style>a{}</style><i></head><body>x</body></html>');
    // A tag the author merely wrote inside a script string is not a boundary.
    expect(injectAtHeadEnd('<html><head><script>var s="</head>";</script></head><body></body></html>', '<i>'))
      .toBe('<html><head><script>var s="</head>";</script><i></head><body></body></html>');
    // No head at all: one is opened rather than dropping the injection.
    expect(injectAtHeadEnd('<html><body>x</body></html>', '<i>'))
      .toBe('<html><head><i></head><body>x</body></html>');
  });
});
