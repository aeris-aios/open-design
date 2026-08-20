import {
  WEB_SIDECAR_INPUTS,
  createOpenDesignRuntimeContext,
  type WebSidecarMethods,
} from "@open-design/contracts/runtime/sidecars";
import { attachSidecar } from "@open-design/sidecar/control";

import { startWebSidecar, type WebSidecarHandle } from "./server.js";

async function main(): Promise<void> {
  let server: WebSidecarHandle | null = null;
  const attached = await attachSidecar<WebSidecarMethods>({
    async initialize(context) {
      server = await startWebSidecar(createOpenDesignRuntimeContext(context));
    },
    handlers: {
      async status(input) {
        WEB_SIDECAR_INPUTS.status.parse(input);
        return await server!.status();
      },
    },
    async onStopRequested() {
      await server?.stop();
      await server?.waitUntilStopped();
    },
  });

  try {
    process.stdout.write(`${JSON.stringify(await server!.status(), null, 2)}\n`);
    await server!.waitUntilStopped();
  } finally {
    await attached.close();
  }
}

void main().then(
  () => {
    // Next dev/runtime internals may retain handles after their public close
    // promises settle. The semantic stop boundary above has already stopped
    // the web server and closed the fenced control descriptor, so force this
    // dedicated sidecar process to complete instead of leaking a hidden owner.
    process.exit(0);
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  },
);
