import type { GenerationRecord, StandaloneStore } from "./store.js";

export type LifecycleStatus = { state: "running" | "stopped"; generationId: string | null };

export interface LifecyclePort {
  start(generation: GenerationRecord): Promise<LifecycleStatus>;
  status(): Promise<LifecycleStatus>;
  stop(): Promise<LifecycleStatus>;
}

export class VersionedLauncher {
  constructor(private readonly store: StandaloneStore, private readonly lifecycle: LifecyclePort) {}

  async start(): Promise<LifecycleStatus> {
    const generation = await this.store.activeGeneration();
    const status = await this.lifecycle.start(generation);
    if (status.state !== "running" || status.generationId !== generation.id) throw new Error("lifecycle did not acknowledge the active generation");
    await this.store.markSuccessful(generation.id);
    return status;
  }

  status(): Promise<LifecycleStatus> { return this.lifecycle.status(); }
  stop(): Promise<LifecycleStatus> { return this.lifecycle.stop(); }
}

export class FossilBootloader {
  constructor(private readonly loadVersionedLauncher: () => Promise<VersionedLauncher>) {}

  async start(): Promise<LifecycleStatus> {
    return (await this.loadVersionedLauncher()).start();
  }
}
