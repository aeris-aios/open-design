#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { canonicalJson, sha256Hex, signStandaloneMetadata, type StandaloneComponent, type StandaloneMetadata, type StandaloneShellDistribution } from "./index.js";

type ComposeRequest = {
  schemaVersion: 1;
  operation: "standalone.compose";
  channel: string;
  releaseVersion: string;
  standaloneVersion: string;
  sourceCommit: string;
  publishedAt: string;
  keyId: string;
  privateKeyFile: string;
  contributionReceipts: string[];
  shellReceipts: string[];
  outputFile: string;
};

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || value == null) throw new Error(`missing ${name}`);
  return value;
}

async function main(): Promise<void> {
  const request = JSON.parse(await readFile(resolve(argument("--request")), "utf8")) as ComposeRequest;
  const receiptPath = resolve(argument("--receipt"));
  if (request.schemaVersion !== 1 || request.operation !== "standalone.compose") throw new Error("unsupported standalone compose request");
  const components: StandaloneComponent[] = [];
  for (const path of request.contributionReceipts) {
    const receipt = JSON.parse(await readFile(resolve(path), "utf8")) as { schemaVersion: number; contribution?: StandaloneComponent };
    if (receipt.schemaVersion !== 1 || receipt.contribution == null) throw new Error(`invalid contribution receipt: ${path}`);
    components.push(receipt.contribution);
  }
  const shells: StandaloneShellDistribution[] = [];
  for (const path of request.shellReceipts) {
    const receipt = JSON.parse(await readFile(resolve(path), "utf8")) as {
      schemaVersion: number;
      owner: string;
      target: StandaloneShellDistribution["target"];
      terminalShellVersion: string;
      officialNodeVersion: string;
      artifacts: StandaloneShellDistribution["artifacts"];
    };
    if (receipt.schemaVersion !== 1 || receipt.owner !== "shells/terminal") throw new Error(`invalid shell receipt: ${path}`);
    shells.push({ shell: "terminal", target: receipt.target, shellVersion: receipt.terminalShellVersion, nodeVersion: receipt.officialNodeVersion, artifacts: receipt.artifacts });
  }
  const metadata: StandaloneMetadata = {
    schemaVersion: 1,
    channel: request.channel,
    releaseVersion: request.releaseVersion,
    standaloneVersion: request.standaloneVersion,
    sourceCommit: request.sourceCommit,
    publishedAt: request.publishedAt,
    components,
    shells,
  };
  const privateKey = await readFile(resolve(request.privateKeyFile), "utf8");
  const envelope = signStandaloneMetadata(metadata, request.keyId, privateKey);
  const outputFile = resolve(request.outputFile);
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, canonicalJson(envelope), "utf8");
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, canonicalJson({
    schemaVersion: 1,
    owner: "packages/standalone",
    operation: "standalone.compose",
    metadataFile: outputFile,
    metadataSha256: sha256Hex(await readFile(outputFile)),
    channel: metadata.channel,
    releaseVersion: metadata.releaseVersion,
  }), "utf8");
}

await main();
