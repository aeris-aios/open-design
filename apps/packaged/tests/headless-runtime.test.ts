import { describe, expect, it, vi } from "vitest";

import {
  acquirePackagedHeadlessStartup,
  parsePackagedHeadlessRequest,
  resolvePackagedMcpBootstrapLaunch,
} from "../src/headless-runtime.js";

describe("parsePackagedHeadlessRequest", () => {
  it("accepts a headless Codex MCP install request", () => {
    expect(parsePackagedHeadlessRequest([
      "--headless",
      "--mcp-install",
      "codex",
    ])).toEqual({
      headless: true,
      mcpInstallAgent: "codex",
    });
  });

  it("rejects unsupported MCP install targets", () => {
    expect(() => parsePackagedHeadlessRequest([
      "--headless",
      "--mcp-install",
      "claude",
    ])).toThrow(/only supports codex/i);
  });
});

describe("resolvePackagedMcpBootstrapLaunch", () => {
  it("uses macOS open against the stable signed app bundle", () => {
    expect(resolvePackagedMcpBootstrapLaunch({
      currentExecutablePath:
        "/private/payload/Open Design.app/Contents/MacOS/Open Design",
      installedLaunchPath: "/Applications/Open Design.app",
      platform: "darwin",
    })).toEqual({
      command: "/usr/bin/open",
      args: [
        "-g",
        "-j",
        "/Applications/Open Design.app",
        "--args",
        "--headless",
      ],
    });
  });

  it("invokes a non-macOS installed launcher directly", () => {
    expect(resolvePackagedMcpBootstrapLaunch({
      currentExecutablePath: "/tmp/payload/open-design",
      installedLaunchPath: "/opt/open-design/open-design",
      platform: "linux",
    })).toEqual({
      command: "/opt/open-design/open-design",
      args: ["--headless"],
    });
  });
});

describe("acquirePackagedHeadlessStartup", () => {
  function createDependencies(failAt: "mcp" | "none" | "web-identity") {
    const closed: string[] = [];
    const exit = vi.fn();
    let closeControl: (() => Promise<void>) | null = null;
    return {
      closed,
      dependencies: {
        confirmRuntime: vi.fn(async () => undefined),
        createControlServer: vi.fn(async ({ lifecycle }) => {
          let closing: Promise<void> | null = null;
          let resolveClosed!: () => void;
          let rejectClosed!: (error: unknown) => void;
          const closedPromise = new Promise<void>((resolve, reject) => {
            resolveClosed = resolve;
            rejectClosed = reject;
          });
          const close = (): Promise<void> => {
            if (closing != null) return closing;
            const operation = lifecycle.stop().then(() => {
              closed.push("ipc");
              resolveClosed();
            }, (error: unknown) => {
              rejectClosed(error);
              throw error;
            });
            closing = operation;
            return operation;
          };
          closeControl = close;
          return {
            closed: closedPromise,
            close,
          };
        }),
        exit,
        installMcp: vi.fn(async () => {
          if (failAt === "mcp") throw new Error("MCP install failed");
        }),
        startSidecars: vi.fn(async () => ({
          close: async () => {
            closed.push("sidecars");
          },
          currentWebUrl: () => "http://127.0.0.1:7456",
          daemon: {
            desktopAuthGateActive: false,
            state: "running" as const,
            url: "http://127.0.0.1:7457",
          },
          web: { state: "running" as const, url: "http://127.0.0.1:7456" },
        })),
        writeIdentity: vi.fn(async () => ({
          close: async () => {
            closed.push("identity");
          },
          identity: {} as never,
        })),
        writeWebIdentity: vi.fn(async () => {
          if (failAt === "web-identity") {
            throw new Error("web identity write failed");
          }
        }),
      },
      exit,
      stopControl: async () => await closeControl?.(),
    };
  }

  it("does not exit an externally stopped headless host until body resources and control close", async () => {
    const { closed, dependencies, exit, stopControl } = createDependencies("none");
    await acquirePackagedHeadlessStartup(dependencies);

    await stopControl();
    await Promise.resolve();

    expect(closed).toEqual(["sidecars", "identity", "ipc"]);
    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("closes identity and sidecars when MCP installation fails", async () => {
    const { closed, dependencies, exit } = createDependencies("mcp");

    await expect(acquirePackagedHeadlessStartup(dependencies)).rejects.toThrow(
      "MCP install failed",
    );

    expect(closed).toEqual(["sidecars", "identity"]);
    expect(exit).not.toHaveBeenCalled();
  });

  it("closes IPC, sidecars, and identity when identity publication fails", async () => {
    const { closed, dependencies, exit } = createDependencies("web-identity");

    await expect(acquirePackagedHeadlessStartup(dependencies)).rejects.toThrow(
      "web identity write failed",
    );

    expect(closed).toEqual(["sidecars", "identity", "ipc"]);
    expect(exit).not.toHaveBeenCalled();
  });
});
