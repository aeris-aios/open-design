import type { SidecarControlAccess } from "@open-design/sidecar/control";
import { describe, expect, it, vi } from "vitest";

import {
  isToolPackStopSafeForRemoval,
  stopToolPackServices,
  summarizeToolPackStopResults,
  withConvergedToolPackServices,
} from "../src/control.js";

describe("tools-pack service convergence", () => {
  it("keeps every unproven stop unsafe even when no PID was reported", () => {
    const stop = summarizeToolPackStopResults("release-beta", {
      attempts: [{
        result: { pid: null, state: "alive" },
        service: "daemon",
        status: "fulfilled",
      }],
      state: "incomplete",
    });

    expect(stop).toEqual({
      gracefulRequested: false,
      namespace: "release-beta",
      remainingPids: [],
      status: "partial",
      stoppedPids: [],
    });
    expect(isToolPackStopSafeForRemoval(stop)).toBe(false);
    expect(isToolPackStopSafeForRemoval({ status: "not-running" })).toBe(true);
    expect(isToolPackStopSafeForRemoval({ status: "stopped" })).toBe(true);
  });

  it.each(["desktop", "web"] as const)(
    "attempts every service before reporting a %s stop failure",
    async (failedService) => {
      const stop = vi.fn(async (service: string) => {
        if (service === failedService) throw new Error(`${service} failed`);
        return { pid: null, state: "absent" as const };
      });
      const control = {
        stop,
        async withLifecycleSession<T>(callback: () => Promise<T>) { return await callback(); },
      } as unknown as SidecarControlAccess;

      await expect(stopToolPackServices(control)).resolves.toMatchObject({ state: "incomplete" });
      expect(stop.mock.calls).toEqual([
        ["web"],
        ["daemon"],
        ["desktop", { graceMs: 15_000 }],
      ]);
    },
  );

  it.each(["desktop", "web"] as const)(
    "refuses replacement when the %s stop is not proven",
    async (unstoppedService) => {
      const stop = vi.fn(async (service: string) => ({
        pid: service === unstoppedService ? 42 : null,
        state: service === unstoppedService ? "alive" as const : "absent" as const,
      }));
      const control = {
        stop,
        async withLifecycleSession<T>(callback: () => Promise<T>) { return await callback(); },
      } as unknown as SidecarControlAccess;

      await expect(withConvergedToolPackServices(control, async () => undefined)).rejects.toThrow(
        "failed to converge one or more packaged services",
      );
      expect(stop.mock.calls).toEqual([
        ["web"],
        ["daemon"],
        ["desktop", { graceMs: 15_000 }],
      ]);
    },
  );
});
