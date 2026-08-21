import { attachSidecar } from "../../src/control/index.js";

type EnvironmentMethods = {
  readEnvironment: {
    input: { key: string };
    output: { value: string | null };
  };
};

await attachSidecar<EnvironmentMethods>({
  handlers: {
    readEnvironment(input) {
      return { value: process.env[input.key] ?? null };
    },
  },
  lifecycle: {
    initialize() {},
    stop() {},
  },
});
