import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { canonicalJson, sha256Hex, verifyStandaloneMetadata, type SignedStandaloneMetadata, type StandaloneComponent } from "./protocol.js";

export type ArtifactReader = (url: string) => Promise<Uint8Array>;

export type GenerationRecord = {
  schemaVersion: 1;
  id: string;
  channel: string;
  releaseVersion: string;
  standaloneVersion: string;
  sourceCommit: string;
  components: Record<string, { entrypoint: string; mode: "required" | "lazy"; path: string; sha256: string }>;
};

export type GenerationState = {
  schemaVersion: 1;
  attempt: string | null;
  active: string | null;
  lastSuccessful: string | null;
};

const INITIAL_STATE: GenerationState = { schemaVersion: 1, attempt: null, active: null, lastSuccessful: null };

function assertNamespace(value: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) throw new Error(`invalid standalone namespace: ${value}`);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, canonicalJson(value), { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export class StandaloneStore {
  readonly root: string;
  readonly namespace: string;

  constructor(root: string, namespace: string) {
    assertNamespace(namespace);
    this.root = root;
    this.namespace = namespace;
  }

  private get statePath(): string { return join(this.root, "namespaces", this.namespace, "state.json"); }
  private generationPath(id: string): string { return join(this.root, "generations", `${id}.json`); }
  private blobPath(sha256: string): string { return join(this.root, "blobs", "sha256", sha256); }

  async readState(): Promise<GenerationState> {
    try { return await readJson<GenerationState>(this.statePath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...INITIAL_STATE };
      throw error;
    }
  }

  private async materialize(component: StandaloneComponent, readArtifact: ArtifactReader): Promise<string> {
    const destination = this.blobPath(component.artifact.sha256);
    try {
      const existing = await readFile(destination);
      if (existing.byteLength !== component.artifact.size || sha256Hex(existing) !== component.artifact.sha256) throw new Error(`existing blob failed verification: ${component.name}`);
      return destination;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const bytes = await readArtifact(component.artifact.url);
    if (bytes.byteLength !== component.artifact.size) throw new Error(`artifact size mismatch: ${component.name}`);
    if (sha256Hex(bytes) !== component.artifact.sha256) throw new Error(`artifact digest mismatch: ${component.name}`);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, bytes, { flag: "wx" });
    try { await rename(temporary, destination); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return destination;
  }

  async prepare(envelope: SignedStandaloneMetadata, publicKey: Parameters<typeof verifyStandaloneMetadata>[1], readArtifact: ArtifactReader): Promise<GenerationRecord> {
    verifyStandaloneMetadata(envelope, publicKey);
    const id = sha256Hex(canonicalJson(envelope.metadata));
    const components: GenerationRecord["components"] = {};
    for (const component of envelope.metadata.components) {
      const path = component.mode === "required" ? await this.materialize(component, readArtifact) : this.blobPath(component.artifact.sha256);
      components[component.name] = { entrypoint: component.artifact.entrypoint, mode: component.mode, path, sha256: component.artifact.sha256 };
    }
    const generation: GenerationRecord = {
      schemaVersion: 1,
      id,
      channel: envelope.metadata.channel,
      releaseVersion: envelope.metadata.releaseVersion,
      standaloneVersion: envelope.metadata.standaloneVersion,
      sourceCommit: envelope.metadata.sourceCommit,
      components,
    };
    await writeJsonAtomic(this.generationPath(id), generation);
    const state = await this.readState();
    await writeJsonAtomic(this.statePath, { ...state, attempt: id });
    return generation;
  }

  async commit(id: string): Promise<void> {
    await readJson<GenerationRecord>(this.generationPath(id));
    const state = await this.readState();
    if (state.attempt !== id) throw new Error(`generation ${id} is not the prepared attempt`);
    await writeJsonAtomic(this.statePath, { ...state, active: id });
  }

  async markSuccessful(id: string): Promise<void> {
    const state = await this.readState();
    if (state.active !== id) throw new Error(`generation ${id} is not active`);
    await writeJsonAtomic(this.statePath, { ...state, attempt: null, lastSuccessful: id });
  }

  async activeGeneration(): Promise<GenerationRecord> {
    const state = await this.readState();
    if (state.active === null) throw new Error("no active standalone generation");
    return readJson<GenerationRecord>(this.generationPath(state.active));
  }
}
