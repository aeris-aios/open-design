import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  collectProcessTreePids,
  listProcessSnapshots,
  stopProcesses,
  waitForProcessExit,
} from "@open-design/platform";

import { WORKSPACE_ROOT } from "../src/config.js";

type StartResult = {
  daemon: { pid: number };
  web: { pid: number };
};

type StopResult = {
  daemon: { status: string; stop: { remainingPids: number[] } };
  web: { status: string; stop: { remainingPids: number[] } };
};

async function runToolsDev<T>(args: string[]): Promise<T> {
  const entry = join(WORKSPACE_ROOT, "tools", "dev", "src", "index.ts");
  const stdout = await new Promise<string>((resolveRun, rejectRun) => {
    execFile(
      process.execPath,
      ["--import", "tsx", entry, ...args, "--json"],
      {
        cwd: WORKSPACE_ROOT,
        encoding: "utf8",
        env: process.env,
        maxBuffer: 8 * 1024 * 1024,
        timeout: 120_000,
      },
      (error, output, stderr) => {
        if (error != null) {
          rejectRun(new Error(`tools-dev ${args.join(" ")} failed: ${stderr || error.message}`));
          return;
        }
        resolveRun(output);
      },
    );
  });
  return JSON.parse(stdout) as T;
}

describe("tools-dev real web lifecycle", () => {
  it("stops the web sidecar and its tsx launcher without leaking across repeated cycles", { timeout: 180_000 }, async () => {
    const toolsDevRoot = await mkdtemp(join(tmpdir(), "od-tools-dev-web-stop-"));
    const namespace = "web-stop-integration";
    const sharedArgs = ["--namespace", namespace, "--tools-dev-root", toolsDevRoot];
    const observedPids = new Set<number>();

    try {
      for (let cycle = 0; cycle < 2; cycle += 1) {
        const started = await runToolsDev<StartResult>(["start", "web", ...sharedArgs]);
        const snapshots = await listProcessSnapshots();

        for (const servicePid of [started.web.pid, started.daemon.pid]) {
          const service = snapshots.find((snapshot) => snapshot.pid === servicePid);
          assert.ok(service, `cycle ${cycle + 1}: missing process snapshot for service pid ${servicePid}`);
          const launcher = snapshots.find((snapshot) => snapshot.pid === service.ppid);
          assert.ok(launcher, `cycle ${cycle + 1}: missing tsx launcher for service pid ${servicePid}`);
          for (const pid of collectProcessTreePids(snapshots, [launcher.pid])) observedPids.add(pid);
        }

        const stopped = await runToolsDev<StopResult>(["stop", "web", ...sharedArgs]);
        assert.equal(stopped.web.status, "stopped");
        assert.deepEqual(stopped.web.stop.remainingPids, []);
        assert.equal(stopped.daemon.status, "stopped");
        assert.deepEqual(stopped.daemon.stop.remainingPids, []);

        for (const pid of observedPids) {
          assert.equal(
            await waitForProcessExit(pid, 10_000),
            true,
            `cycle ${cycle + 1}: lifecycle process ${pid} remained alive after stop`,
          );
        }
      }
    } finally {
      await runToolsDev<StopResult>(["stop", "web", ...sharedArgs]).catch(() => undefined);
      const snapshots = await listProcessSnapshots();
      const remainingOwnedRoots = snapshots
        .filter((snapshot) =>
          observedPids.has(snapshot.pid)
          && snapshot.command.includes(WORKSPACE_ROOT)
          && (
            snapshot.command.includes("apps/web/sidecar/index.ts")
            || snapshot.command.includes("apps/daemon/src/sidecar/index.ts")
          )
        )
        .map((snapshot) => snapshot.pid);
      const remainingTrees = collectProcessTreePids(snapshots, remainingOwnedRoots);
      if (remainingTrees.length > 0) await stopProcesses(remainingTrees);
      await rm(toolsDevRoot, { force: true, recursive: true });
    }
  });
});
