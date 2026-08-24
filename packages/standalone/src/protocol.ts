import { createHash, sign, verify, type KeyLike } from "node:crypto";

export const STANDALONE_METADATA_SCHEMA = 1 as const;
export const STANDALONE_SIGNATURE_ALGORITHM = "Ed25519" as const;
export const EXACT_CHANNEL_PATTERN = /^[a-z0-9]{1,12}$/;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type ComponentMode = "required" | "lazy";

export type StandaloneComponent = {
  name: string;
  mode: ComponentMode;
  artifact: { entrypoint: string; sha256: string; size: number; url: string };
};

export type StandaloneShellDistribution = {
  shell: "terminal";
  target: "darwin-arm64" | "win32-x64";
  shellVersion: string;
  nodeVersion: string;
  artifacts: Array<{ kind: "official-node" | "terminal-shell"; sha256: string; size: number; url: string }>;
};

export type StandaloneMetadata = {
  schemaVersion: typeof STANDALONE_METADATA_SCHEMA;
  channel: string;
  releaseVersion: string;
  standaloneVersion: string;
  sourceCommit: string;
  publishedAt: string;
  components: StandaloneComponent[];
  shells: StandaloneShellDistribution[];
};

export type SignedStandaloneMetadata = {
  metadata: StandaloneMetadata;
  signature: {
    algorithm: typeof STANDALONE_SIGNATURE_ALGORITHM;
    keyId: string;
    value: string;
  };
};

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonicalValue(input[key])]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalValue(value))}\n`;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function validateStandaloneMetadata(metadata: StandaloneMetadata): void {
  if (metadata.schemaVersion !== STANDALONE_METADATA_SCHEMA) throw new Error("unsupported standalone metadata schema");
  if (!EXACT_CHANNEL_PATTERN.test(metadata.channel) || metadata.channel === "local") throw new Error(`invalid exact channel: ${metadata.channel}`);
  if (!new RegExp(`^\\d+\\.\\d+\\.\\d+-${metadata.channel}\\.\\d+$`).test(metadata.releaseVersion)) {
    throw new Error(`releaseVersion does not belong to ${metadata.channel}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(metadata.standaloneVersion)) throw new Error("invalid standaloneVersion");
  if (!/^[a-f0-9]{40}$/.test(metadata.sourceCommit)) throw new Error("sourceCommit must be a full 40-character SHA");
  if (!Number.isFinite(Date.parse(metadata.publishedAt))) throw new Error("invalid publishedAt");
  if (metadata.components.length === 0) throw new Error("metadata must contain at least one component");
  const names = new Set<string>();
  for (const component of metadata.components) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(component.name) || names.has(component.name)) throw new Error(`invalid or duplicate component: ${component.name}`);
    names.add(component.name);
    if (!SHA256_PATTERN.test(component.artifact.sha256)) throw new Error(`invalid digest for ${component.name}`);
    if (!Number.isSafeInteger(component.artifact.size) || component.artifact.size < 0) throw new Error(`invalid size for ${component.name}`);
    if (!/^https?:\/\//.test(component.artifact.url) && !/^file:\/\//.test(component.artifact.url)) throw new Error(`invalid URL for ${component.name}`);
    if (component.artifact.entrypoint.startsWith("/") || component.artifact.entrypoint.split(/[\\/]/).includes("..")) throw new Error(`unsafe entrypoint for ${component.name}`);
  }
  const shellTargets = new Set<string>();
  for (const shell of metadata.shells) {
    if (shell.shell !== "terminal" || !new Set(["darwin-arm64", "win32-x64"]).has(shell.target)) throw new Error("unsupported shell distribution");
    if (shellTargets.has(shell.target)) throw new Error(`duplicate shell target: ${shell.target}`);
    shellTargets.add(shell.target);
    if (!/^\d+\.\d+\.\d+$/.test(shell.shellVersion) || !/^\d+\.\d+\.\d+$/.test(shell.nodeVersion)) throw new Error(`invalid shell version for ${shell.target}`);
    if (shell.artifacts.length !== 2) throw new Error(`incomplete shell artifacts for ${shell.target}`);
    for (const artifact of shell.artifacts) {
      if (!SHA256_PATTERN.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size < 0 || !/^https?:\/\//.test(artifact.url)) throw new Error(`invalid shell artifact for ${shell.target}`);
    }
  }
  if (shellTargets.size !== 2 || !shellTargets.has("darwin-arm64") || !shellTargets.has("win32-x64")) {
    throw new Error("metadata must contain darwin-arm64 and win32-x64 Terminal distributions");
  }
}

export function signStandaloneMetadata(metadata: StandaloneMetadata, keyId: string, privateKey: KeyLike): SignedStandaloneMetadata {
  validateStandaloneMetadata(metadata);
  return {
    metadata,
    signature: {
      algorithm: STANDALONE_SIGNATURE_ALGORITHM,
      keyId,
      value: sign(null, Buffer.from(canonicalJson(metadata)), privateKey).toString("base64"),
    },
  };
}

export function verifyStandaloneMetadata(envelope: SignedStandaloneMetadata, publicKey: KeyLike): void {
  validateStandaloneMetadata(envelope.metadata);
  if (envelope.signature.algorithm !== STANDALONE_SIGNATURE_ALGORITHM) throw new Error("unsupported metadata signature algorithm");
  const valid = verify(null, Buffer.from(canonicalJson(envelope.metadata)), publicKey, Buffer.from(envelope.signature.value, "base64"));
  if (!valid) throw new Error("standalone metadata signature verification failed");
}
