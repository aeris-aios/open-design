import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { SidecarFactory } from '@open-design/sidecar';
import {
  SIDECAR_MESSAGES,
  normalizeDesktopSidecarMessage,
  type DesktopStatusSnapshot,
} from '@open-design/sidecar-proto';
import { PNG } from 'pngjs';

const witnessPath = process.env.OD_E2E_HYPERFRAMES_DOCUMENT_WITNESS;
if (witnessPath == null) throw new Error('OD_E2E_HYPERFRAMES_DOCUMENT_WITNESS is required');

const framePng = solidPng(320, 180);
const client = SidecarFactory.create<DesktopStatusSnapshot>({
  handlers: {
    async [SIDECAR_MESSAGES.RENDER_FRAMES](input) {
      const request = normalizeDesktopSidecarMessage({
        input,
        type: SIDECAR_MESSAGES.RENDER_FRAMES,
      });
      if (request.type !== SIDECAR_MESSAGES.RENDER_FRAMES) {
        throw new Error(`unexpected desktop request: ${request.type}`);
      }
      await mkdir(request.input.outputDir, { recursive: true });
      await writeFile(witnessPath, request.input.html, 'utf8');
      for (let frame = 0; frame < 3; frame += 1) {
        await writeFile(
          join(request.input.outputDir, `frame-${String(frame).padStart(8, '0')}.png`),
          framePng,
        );
      }
      return {
        duration: 0.1,
        fps: 30,
        frameCount: 3,
        framePattern: join(request.input.outputDir, 'frame-%08d.png'),
        height: 180,
        ok: true,
        width: 320,
      };
    },
  },
  lifecycle: {
    async start(resources) {
      return {
        capabilities: { frameRenderer: true },
        pid: resources.pid,
        state: 'running',
        updatedAt: new Date().toISOString(),
        url: null,
        windowVisible: false,
      };
    },
    status(runtime) {
      return runtime;
    },
    async stop() {},
  },
});

await client.start();
await client.waitUntilStopped();

function solidPng(width: number, height: number): Buffer {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = 16;
    image.data[offset + 1] = 37;
    image.data[offset + 2] = 63;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
}
