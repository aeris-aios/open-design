import {
  canonicalJson,
  sha256Hex,
  verifyStandaloneChannelHead,
  verifyStandaloneMetadata,
  type SignedStandaloneChannelHead,
  type SignedStandaloneMetadata,
  type StandaloneTrustedKeyRing,
} from "./protocol.js";
import { type ArtifactReader, type GenerationRecord, StandaloneStore } from "./store.js";
import { VersionedLauncher, type LifecycleStatus } from "./launcher.js";

export type StandaloneUpdateSource = {
  readChannelHead(channel: string): Promise<SignedStandaloneChannelHead>;
  readArtifact: ArtifactReader;
};

export type InstalledShellIdentity = {
  shell: string;
  target: string;
  shellVersion: string;
  runtime: { name: string; version: string };
};

export type UpdatePreparation =
  | { status: "prepared"; generation: GenerationRecord }
  | { status: "current"; generationId: string; applyRequired: boolean }
  | { status: "shell-reinstall-required"; releaseVersion: string };

function parseEnvelope(bytes: Uint8Array): SignedStandaloneMetadata {
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as SignedStandaloneMetadata;
}

function versionOrder(value: string, channel: string): number[] {
  const match = new RegExp(`^(\\d+)\\.(\\d+)\\.(\\d+)-${channel}\\.(\\d+)$`).exec(value);
  if (match == null) throw new Error(`invalid ${channel} release version: ${value}`);
  return match.slice(1).map(Number);
}

function compareVersions(left: string, right: string, channel: string): number {
  const a = versionOrder(left, channel);
  const b = versionOrder(right, channel);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

export class StandaloneUpdater {
  constructor(
    private readonly channel: string,
    private readonly contentLane: string,
    private readonly shell: InstalledShellIdentity,
    private readonly trustedKeys: StandaloneTrustedKeyRing,
    private readonly store: StandaloneStore,
    private readonly source: StandaloneUpdateSource,
  ) {}

  /** Download and verify in the background; activation is intentionally deferred. */
  async prepareLatest(): Promise<UpdatePreparation> {
    const signedHead = await this.source.readChannelHead(this.channel);
    verifyStandaloneChannelHead(signedHead, this.trustedKeys);
    const head = signedHead.head;
    if (head.channel !== this.channel) throw new Error("channel head escaped updater namespace");
    const lane = head.lanes[this.contentLane];
    if (lane == null) throw new Error(`channel head lacks content lane: ${this.contentLane}`);
    const bytes = await this.source.readArtifact(lane.url);
    if (bytes.byteLength !== lane.size || sha256Hex(bytes) !== lane.sha256) throw new Error(`${this.contentLane} lane metadata failed binding verification`);
    const envelope = parseEnvelope(bytes);
    verifyStandaloneMetadata(envelope, this.trustedKeys);
    if (envelope.metadata.channel !== this.channel || envelope.metadata.releaseVersion !== lane.releaseVersion) {
      throw new Error(`${this.contentLane} lane metadata identity mismatch`);
    }
    const compatible = envelope.metadata.shellCompatibility.some((candidate) =>
      candidate.shell === this.shell.shell
      && candidate.target === this.shell.target
      && candidate.shellVersion === this.shell.shellVersion
      && candidate.runtime.name === this.shell.runtime.name
      && candidate.runtime.version === this.shell.runtime.version
    );
    if (!compatible) return { status: "shell-reinstall-required", releaseVersion: lane.releaseVersion };
    const id = sha256Hex(canonicalJson(envelope.metadata));
    const state = await this.store.readState();
    if (state.attempt === id) return { status: "current", generationId: id, applyRequired: true };
    if (state.active === id) return { status: "current", generationId: id, applyRequired: false };
    if (state.active !== null) {
      const active = await this.store.activeGeneration();
      const order = compareVersions(active.releaseVersion, lane.releaseVersion, this.channel);
      if (order > 0) throw new Error(`channel head would downgrade ${active.releaseVersion} to ${lane.releaseVersion}`);
      if (order === 0) return { status: "current", generationId: active.id, applyRequired: false };
    }
    const generation = await this.store.prepare(envelope, this.trustedKeys, (url) => this.source.readArtifact(url));
    return { status: "prepared", generation };
  }

  /** Called by the fossil boot path before loading the versioned launcher. */
  activateOnColdStart(): Promise<GenerationRecord | null> {
    return this.store.activatePrepared();
  }

  async applyNow(launcher: VersionedLauncher): Promise<LifecycleStatus> {
    const state = await this.store.readState();
    if (state.attempt === null || state.attempt === state.active) throw new Error("no prepared generation to apply");
    await launcher.stop();
    const activated = await this.store.activatePrepared();
    if (activated === null) throw new Error("no prepared generation to apply");
    return launcher.start();
  }
}
