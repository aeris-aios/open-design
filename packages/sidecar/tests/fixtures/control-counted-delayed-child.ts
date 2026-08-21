import { appendFileSync } from "node:fs";

import { attachSidecar } from "../../src/control/index.js";

import type { DemoMethods } from "./control-controller.js";

const markerPath = process.argv.at(-1);
if (markerPath == null) throw new Error("counted child marker path is required");
appendFileSync(markerPath, `${process.pid}\n`, "utf8");

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
