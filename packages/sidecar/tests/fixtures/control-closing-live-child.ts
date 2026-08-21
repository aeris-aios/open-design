import { attachSidecar } from "../../src/control/index.js";

import type { DemoMethods } from "./control-controller.js";

const keepAlive = setInterval(() => undefined, 1_000);

await attachSidecar<DemoMethods>({
  handlers: {
    context(_input, context) {
      return context;
    },
    echo(input) {
      return { value: input.value };
    },
  },
  async onStopRequested() {
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 100));
  },
});

process.once("exit", () => clearInterval(keepAlive));
