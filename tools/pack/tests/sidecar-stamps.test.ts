import { describe, expect, it } from "vitest";

import type { ToolPackConfig } from "@/config/index.js";
import { allPackagedSidecarStopRequests } from "@/config/sidecar-stamps.js";

describe("packaged sidecar resource declaration", () => {
  it("declares both launch sources, every runtime app, and both desktop modes", () => {
    const config = {
      appVersion: "0.10.0-beta.1",
      namespace: "release-beta-win",
    } as ToolPackConfig;

    const stamps = allPackagedSidecarStopRequests(config).map(({ stamp }) => stamp);

    expect(stamps).toHaveLength(8);
    expect(new Set(stamps.map(({ channel }) => channel))).toEqual(new Set(["beta"]));
    expect(new Set(stamps.map(({ source }) => source))).toEqual(new Set(["tools-pack", "packaged"]));
    expect(stamps.filter(({ app, mode }) => app === "desktop" && mode === "runtime")).toHaveLength(2);
    expect(stamps.filter(({ app, mode }) => app === "desktop" && mode === "headless")).toHaveLength(2);
    expect(stamps.filter(({ app, mode }) => app === "web" && mode === "runtime")).toHaveLength(2);
    expect(stamps.filter(({ app, mode }) => app === "daemon" && mode === "runtime")).toHaveLength(2);
  });
});
