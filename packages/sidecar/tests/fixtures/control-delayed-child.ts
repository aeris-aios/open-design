import { attachSidecar } from "../../src/control/index.js";

import type { DemoMethods } from "./control-controller.js";

await attachSidecar<DemoMethods>({
  handlers: {
    context(_input, context) {
      return context;
    },
    echo(input) {
      return { value: input.value };
    },
  },
  async initialize() {
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 100));
  },
});
