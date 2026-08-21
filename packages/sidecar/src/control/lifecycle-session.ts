import { AsyncLocalStorage } from "node:async_hooks";
import { connect, createServer, type Server } from "node:net";
import { rm } from "node:fs/promises";

import { isWindowsNamedPipePath } from "../ipc-path.js";
import { SidecarControlError } from "./error.js";

const SESSION_POLL_MS = 25;

type HeldSession = { active: boolean; endpointPath: string };
const heldSession = new AsyncLocalStorage<HeldSession>();

async function endpointAcceptsConnections(endpointPath: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = connect(endpointPath);
    let settled = false;
    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function listen(endpointPath: string): Promise<Server> {
  return await new Promise<Server>((resolve, reject) => {
    const server = createServer((socket) => socket.end());
    server.once("error", reject);
    server.listen(endpointPath, () => {
      server.removeListener("error", reject);
      server.on("error", () => undefined);
      server.unref();
      resolve(server);
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function acquire(endpointPath: string, timeoutMs: number): Promise<Server> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      return await listen(endpointPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE") throw error;
      if (!isWindowsNamedPipePath(endpointPath) && !await endpointAcceptsConnections(endpointPath)) {
        await rm(endpointPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new SidecarControlError("peer-unavailable", "sidecar lifecycle session timed out");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, SESSION_POLL_MS));
    }
  }
}

export async function withLifecycleSession<T>(
  endpointPath: string,
  callback: () => Promise<T>,
  timeoutMs = 180_000,
): Promise<T> {
  const current = heldSession.getStore();
  if (current?.active === true && current.endpointPath === endpointPath) return await callback();

  const server = await acquire(endpointPath, timeoutMs);
  const session: HeldSession = { active: true, endpointPath };
  try {
    return await heldSession.run(session, callback);
  } finally {
    session.active = false;
    await close(server);
  }
}
