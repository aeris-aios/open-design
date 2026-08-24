#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { FossilBootloader, StandaloneStore, VersionedLauncher, type SignedStandaloneMetadata } from "@open-design/standalone";
import { FileFixtureLifecyclePort, TERMINAL_SHELL_IDENTITY } from "./index.js";

function option(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1] ?? fallback;
  if (value == null) throw new Error(`missing ${name}`);
  return value;
}

async function readArtifact(url: string): Promise<Uint8Array> {
  if (url.startsWith("file://")) return readFile(new URL(url));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`artifact request failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const root = resolve(option("--root"));
  const namespace = option("--namespace", "terminal-local");
  const store = new StandaloneStore(root, namespace);
  const lifecycle = new FileFixtureLifecyclePort(root, namespace);
  const launcher = new VersionedLauncher(store, lifecycle);
  let output: unknown;
  if (command === "install") {
    const envelope = JSON.parse(await readFile(resolve(option("--metadata")), "utf8")) as SignedStandaloneMetadata;
    const publicKey = await readFile(resolve(option("--public-key")), "utf8");
    const generation = await store.prepare(envelope, publicKey, readArtifact);
    await store.commit(generation.id);
    output = { schemaVersion: 1, shell: TERMINAL_SHELL_IDENTITY.shell, operation: "install", generation };
  } else if (command === "start") {
    output = await new FossilBootloader(async () => launcher).start();
  } else if (command === "status") {
    output = await launcher.status();
  } else if (command === "stop") {
    output = await launcher.stop();
  } else if (command === "inspect") {
    output = { shell: TERMINAL_SHELL_IDENTITY, state: await store.readState(), lifecycle: await launcher.status() };
  } else {
    throw new Error("usage: open-design-terminal <install|start|status|inspect|stop> --root <path> [--namespace <name>]");
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

await main();
