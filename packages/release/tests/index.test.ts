import { describe, expect, it } from "vitest";

import {
  formatReleaseVersion,
  compareReleaseBaseVersions,
  parseReleaseBaseVersion,
  parseReleaseVersion,
  releaseChannelDescriptor,
  releaseChannelFromIdentity,
  releaseChannelFromNamespace,
  releaseChannelFromVersion,
  releaseInstallIdentity,
  releaseMetadataVersionFields,
  releaseNamespace,
  resolveWindowsReleaseNamespaceToken,
  resolveWindowsUninstallRegistryKey,
  isReleaseChannel,
} from "../src/index.js";

describe("@open-design/release", () => {
  it("formats and parses counted release versions", () => {
    expect(formatReleaseVersion("prerelease", "1.2.3", 4)).toBe("1.2.3-prerelease.4");
    expect(parseReleaseVersion("1.2.3-prerelease.4", "prerelease")).toEqual({
      baseVersion: "1.2.3",
      channel: "prerelease",
      number: 4,
      releaseVersion: "1.2.3-prerelease.4",
    });
  });

  it("parses and compares stable base versions", () => {
    expect(parseReleaseBaseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseReleaseBaseVersion("1.2")).toBeNull();
    expect(compareReleaseBaseVersions([1, 2, 4], [1, 2, 3])).toBe(1);
    expect(compareReleaseBaseVersions([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(compareReleaseBaseVersions([1, 2, 3], [1, 3, 0])).toBe(-1);
  });

  it("derives metadata fields from the channel descriptor", () => {
    expect(releaseMetadataVersionFields("stable", "1.2.3")).toEqual({
      baseVersion: "1.2.3",
      releaseVersion: "1.2.3",
      stableVersion: "1.2.3",
    });
    expect(releaseMetadataVersionFields("preview", "1.2.3-preview.5")).toMatchObject({
      baseVersion: "1.2.3",
      releaseNumber: 5,
      releaseVersion: "1.2.3-preview.5",
    });
  });

  it("centralizes release identity and namespace derivation", () => {
    expect(releaseChannelDescriptor("prerelease").productName).toBe("Open Design Prerelease");
    expect(releaseInstallIdentity("prerelease")).toEqual({
      appId: "io.open-design.desktop.prerelease",
      executableName: "Open Design Prerelease",
      productName: "Open Design Prerelease",
    });
    expect(releaseNamespace("prerelease")).toBe("release-prerelease");
    expect(releaseNamespace("prerelease", "win")).toBe("release-prerelease-win");
    expect(releaseNamespace("prerelease", "macIntel")).toBe("release-prerelease-intel");
    expect(releaseChannelDescriptor("qa2")).toMatchObject({
      appId: "io.open-design.desktop.qa2",
      channel: "qa2",
      productName: "Open Design Qa2",
      storagePrefix: "qa2",
    });
  });

  it("limits exact names to 1-12 lowercase letters or digits", () => {
    expect(isReleaseChannel("beta")).toBe(true);
    expect(isReleaseChannel("qa1234567890")).toBe(true);
    expect(isReleaseChannel("local")).toBe(false);
    expect(isReleaseChannel("qa-2")).toBe(false);
    expect(isReleaseChannel("Beta")).toBe(false);
    expect(isReleaseChannel("qa12345678901")).toBe(false);
  });

  it("infers release channels from versions and namespaces", () => {
    expect(releaseChannelFromVersion("1.2.3-beta.1")).toBe("beta");
    expect(releaseChannelFromVersion("1.2.3-beta-internal.1")).toBe("beta");
    expect(releaseChannelFromVersion("1.2.3-prerelease.1")).toBe("prerelease");
    expect(releaseChannelFromNamespace("release-preview-linux")).toBe("preview");
    expect(releaseChannelFromNamespace("open-design")).toBe("stable");
    expect(releaseChannelFromNamespace("beta-local-flow")).toBeNull();
    expect(releaseChannelFromNamespace("release-local")).toBeNull();
  });

  it("resolves one channel identity from version then namespace", () => {
    expect(releaseChannelFromIdentity("1.2.3-beta.1", "release-preview", "default")).toBe("beta");
    expect(releaseChannelFromIdentity("1.2.3", "default", "default")).toBe("stable");
    expect(releaseChannelFromIdentity(null, "release-beta-linux", "default")).toBe("beta");
    expect(releaseChannelFromIdentity(null, "local-smoke", "default")).toBeNull();
  });

  it("derives Windows release identity from the same namespace token", () => {
    expect(resolveWindowsReleaseNamespaceToken("release beta/win x64")).toBe(
      "release-beta-win-x64",
    );
    expect(resolveWindowsUninstallRegistryKey("release beta/win x64")).toBe(
      "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Open Design-release-beta-win-x64",
    );
  });

});
