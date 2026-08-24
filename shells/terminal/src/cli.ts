#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { FossilBootloader, StandaloneStore, StandaloneUpdater, VersionedLauncher, type SignedStandaloneChannelHead, type SignedStandaloneMetadata } from "@open-design/standalone";
import { FileFixtureLifecyclePort, OFFICIAL_NODE_VERSION, TERMINAL_SHELL_IDENTITY, TERMINAL_SHELL_VERSION } from "./index.js";

function option(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    if (fallback == null) throw new Error(`missing ${name}`);
    return fallback;
  }
  const value = process.argv[index + 1];
  if (value == null) throw new Error(`missing value for ${name}`);
  return value;
}

async function readArtifact(url: string): Promise<Uint8Array> {
  if (url.startsWith("file://")) return readFile(new URL(url));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`artifact request failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function hostTarget(): "darwin-arm64" | "win32-x64" {
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64";
  if (process.platform === "win32" && process.arch === "x64") return "win32-x64";
  return option("--target") as "darwin-arm64" | "win32-x64";
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const root = resolve(option("--root"));
  const channelIndex = process.argv.indexOf("--channel");
  const requestedChannel = channelIndex < 0 ? undefined : process.argv[channelIndex + 1];
  const namespace = option("--namespace", requestedChannel == null ? "terminal-local" : `terminal-${requestedChannel}`);
  const store = new StandaloneStore(root, namespace);
  const lifecycle = new FileFixtureLifecyclePort(root, namespace);
  const launcher = new VersionedLauncher(store, lifecycle);
  let output: unknown;
  if (command === "install") {
    const envelope = JSON.parse(await readFile(resolve(option("--metadata")), "utf8")) as SignedStandaloneMetadata;
    const publicKey = await readFile(resolve(option("--public-key")), "utf8");
    const keyId = option("--key-id", envelope.signatures[0]?.keyId);
    const generation = await store.prepare(envelope, new Map([[keyId, publicKey]]), readArtifact);
    await store.commit(generation.id);
    output = { schemaVersion: 1, shell: TERMINAL_SHELL_IDENTITY.shell, operation: "install", generation };
  } else if (command === "start") {
    await store.activatePrepared();
    output = await new FossilBootloader(async () => launcher).start();
  } else if (command === "update" || command === "apply-update") {
    const channel = option("--channel");
    if (!namespace.startsWith(`terminal-${channel}`)) throw new Error("update namespace must be bound to its exact channel");
    const headUrl = option("--channel-head");
    const trusted = JSON.parse(await readFile(resolve(option("--trusted-keys")), "utf8")) as Record<string, string>;
    const updater = new StandaloneUpdater(
      channel,
      "closure",
      { shell: "terminal", target: hostTarget(), shellVersion: TERMINAL_SHELL_VERSION, runtime: { name: "node", version: OFFICIAL_NODE_VERSION } },
      trusted,
      store,
      { readChannelHead: async () => JSON.parse(Buffer.from(await readArtifact(headUrl)).toString("utf8")) as SignedStandaloneChannelHead, readArtifact },
    );
    const preparation = await updater.prepareLatest();
    output = command === "apply-update" && preparation.status === "prepared"
      ? { preparation, lifecycle: await updater.applyNow(launcher) }
      : preparation;
  } else if (command === "status") {
    output = await launcher.status();
  } else if (command === "stop") {
    output = await launcher.stop();
  } else if (command === "inspect") {
    output = { shell: TERMINAL_SHELL_IDENTITY, state: await store.readState(), lifecycle: await launcher.status() };
  } else {
    throw new Error("usage: open-design-terminal <install|update|apply-update|start|status|inspect|stop> --root <path> [options]");
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

await main();
