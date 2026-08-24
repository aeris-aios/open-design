#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { canonicalJson, sha256Hex } from "@open-design/standalone";
import { OFFICIAL_NODE_VERSION, TERMINAL_SHELL_VERSION } from "./index.js";

type TerminalPackRequest = {
  schemaVersion: 1;
  operation: "terminal.pack";
  target: "darwin-arm64" | "win32-x64";
  nodeArchiveFile: string;
  nodeArchiveSha256: string;
  artifactBaseUrl: string;
  outputDirectory: string;
};

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || value == null) throw new Error(`missing ${name}`);
  return value;
}

async function main(): Promise<void> {
  const request = JSON.parse(await readFile(resolve(argument("--request")), "utf8")) as TerminalPackRequest;
  const receiptPath = resolve(argument("--receipt"));
  if (request.schemaVersion !== 1 || request.operation !== "terminal.pack") throw new Error("unsupported Terminal pack request");
  if (!new Set(["darwin-arm64", "win32-x64"]).has(request.target)) throw new Error(`unsupported Terminal target: ${request.target}`);
  const nodeSource = resolve(request.nodeArchiveFile);
  const nodeBytes = await readFile(nodeSource);
  if (sha256Hex(nodeBytes) !== request.nodeArchiveSha256) throw new Error("official Node archive digest mismatch");
  if (!basename(nodeSource).includes(`v${OFFICIAL_NODE_VERSION}`)) throw new Error(`Node archive filename must identify v${OFFICIAL_NODE_VERSION}`);
  const outputDirectory = resolve(request.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const nodeFile = resolve(outputDirectory, basename(nodeSource));
  const shellFile = resolve(outputDirectory, `open-design-terminal-${TERMINAL_SHELL_VERSION}-${request.target}.mjs`);
  await copyFile(nodeSource, nodeFile);
  await copyFile(new URL("./cli.mjs", import.meta.url), shellFile);
  const shellBytes = await readFile(shellFile);
  const artifactBaseUrl = request.artifactBaseUrl.replace(/\/$/, "");
  const receipt = {
    schemaVersion: 1,
    owner: "shells/terminal",
    operation: "terminal.pack",
    target: request.target,
    terminalShellVersion: TERMINAL_SHELL_VERSION,
    officialNodeVersion: OFFICIAL_NODE_VERSION,
    artifacts: [
      { kind: "official-node", file: nodeFile, url: `${artifactBaseUrl}/${basename(nodeFile)}`, sha256: request.nodeArchiveSha256, size: nodeBytes.byteLength },
      { kind: "terminal-shell", file: shellFile, url: `${artifactBaseUrl}/${basename(shellFile)}`, sha256: sha256Hex(shellBytes), size: shellBytes.byteLength },
    ],
  };
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, canonicalJson(receipt), "utf8");
}

await main();
