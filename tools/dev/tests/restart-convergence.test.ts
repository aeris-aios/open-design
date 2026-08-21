import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { startAfterConvergedStops } from "../src/restart-convergence.js";

describe("tools-dev restart convergence", () => {
  it("does not start a replacement after an unproven stop", async () => {
    let starts = 0;
    await assert.rejects(
      startAfterConvergedStops({
        daemon: { app: "daemon", status: "stopped" },
        web: { app: "web", status: "partial" },
      }, async () => {
        starts += 1;
        return "started";
      }),
      /refusing tools-dev restart after an unproven stop/,
    );
    assert.equal(starts, 0);
  });

  it("starts only after every stop is proven", async () => {
    await assert.doesNotReject(startAfterConvergedStops({
      daemon: { app: "daemon", status: "not-running" },
      web: { app: "web", status: "stopped" },
    }, async () => "started"));
  });
});
