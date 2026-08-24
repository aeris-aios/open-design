#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "@open-design/standalone";
import { CLOSURE_VERSION, createClosureFixtureContribution } from "./index.js";

type PackRequest = {
  schemaVersion: 1;
  operation: "closure.pack";
  target: "universal";
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
  const requestPath = resolve(argument("--request"));
  const receiptPath = resolve(argument("--receipt"));
  const request = JSON.parse(await readFile(requestPath, "utf8")) as PackRequest;
  if (request.schemaVersion !== 1 || request.operation !== "closure.pack") throw new Error("unsupported Closure pack request");
  if (request.target !== "universal") throw new Error(`unsupported Closure target: ${request.target}`);
  const source = fileURLToPath(new URL("./fixture.mjs", import.meta.url));
  const bytes = await readFile(source);
  const fileName = `closure-${CLOSURE_VERSION}-${request.target}.mjs`;
  const destination = resolve(request.outputDirectory, fileName);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const url = `${request.artifactBaseUrl.replace(/\/$/, "")}/${fileName}`;
  const receipt = {
    schemaVersion: 1,
    owner: "apps/closure",
    operation: "closure.pack",
    closureVersion: CLOSURE_VERSION,
    target: request.target,
    artifactFile: destination,
    contribution: createClosureFixtureContribution({ artifactUrl: url, artifactBytes: bytes }),
  };
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, canonicalJson(receipt), "utf8");
}

await main();
