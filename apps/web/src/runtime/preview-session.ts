import type {
  PreviewRuntimeCapability,
  PreviewRuntimeDocumentIdentity,
  PreviewRuntimeMessage,
} from '@open-design/contracts/runtime/preview-runtime';
import {
  PreviewRuntimeController,
  type PreviewRuntimeMessageEvent,
  type PreviewRuntimeMessageTarget,
} from './preview-runtime-controller';

export interface PreviewSessionDocument extends PreviewRuntimeDocumentIdentity {
  url: string;
  target: PreviewRuntimeMessageTarget;
}

export interface PreviewSessionSnapshot {
  current: PreviewRuntimeDocumentIdentity | null;
  standby: PreviewRuntimeDocumentIdentity | null;
  standbyReady: boolean;
  suspended: boolean;
}

export interface PreviewSessionCallbacks {
  onStandbyReady?: (document: PreviewSessionDocument) => void;
  onPromoted?: (
    current: PreviewSessionDocument,
    previous: PreviewSessionDocument | null,
  ) => void;
  onStandbyDiscarded?: (document: PreviewSessionDocument) => void;
  onSnapshotChanged?: (snapshot: PreviewSessionSnapshot) => void;
}

interface ManagedPreviewDocument {
  document: PreviewSessionDocument;
  controller: PreviewRuntimeController;
  ready: boolean;
}

/**
 * Own the last-good/standby lifecycle for one retained preview slot.
 *
 * This class intentionally does not mutate iframe URLs or DOM visibility.
 * React owns those nodes; the session only promotes an exact, fenced standby
 * after the runtime proves a visible paint. Preview/Code and tab switches set
 * `suspended` and therefore never navigate the retained browsing context.
 */
export class PreviewSession {
  readonly #callbacks: PreviewSessionCallbacks;
  #enabledCapabilities: PreviewRuntimeCapability[];
  #current: ManagedPreviewDocument | null = null;
  #standby: ManagedPreviewDocument | null = null;
  #suspended = false;

  constructor(options: {
    enabledCapabilities?: readonly PreviewRuntimeCapability[];
    callbacks?: PreviewSessionCallbacks;
  } = {}) {
    this.#enabledCapabilities = [...(options.enabledCapabilities ?? [])];
    this.#callbacks = options.callbacks ?? {};
  }

  stageDocument(document: PreviewSessionDocument): void {
    if (sameDocument(this.#current?.document, document)) return;
    if (sameDocument(this.#standby?.document, document)) return;
    if (this.#standby) this.#callbacks.onStandbyDiscarded?.(this.#standby.document);

    const managed: ManagedPreviewDocument = {
      document,
      ready: false,
      controller: new PreviewRuntimeController({
        identity: document,
        target: document.target,
        enabledCapabilities: this.#enabledCapabilities,
        callbacks: {
          onReady: () => {
            if (this.#standby !== managed) return;
            managed.ready = true;
            this.#callbacks.onStandbyReady?.(managed.document);
            this.#emitSnapshot();
          },
          onVisiblePaint: () => this.#promote(managed),
        },
      }),
    };
    this.#standby = managed;
    this.#emitSnapshot();
  }

  discardStandby(identity?: PreviewRuntimeDocumentIdentity): void {
    if (!this.#standby) return;
    if (identity && !sameIdentity(this.#standby.document, identity)) return;
    const discarded = this.#standby.document;
    this.#standby = null;
    this.#callbacks.onStandbyDiscarded?.(discarded);
    this.#emitSnapshot();
  }

  setEnabledCapabilities(capabilities: readonly PreviewRuntimeCapability[]): void {
    this.#enabledCapabilities = [...capabilities];
    this.#current?.controller.setEnabledCapabilities(capabilities);
    this.#standby?.controller.setEnabledCapabilities(capabilities);
  }

  setSuspended(suspended: boolean): void {
    if (this.#suspended === suspended) return;
    this.#suspended = suspended;
    this.#emitSnapshot();
  }

  handleMessage(event: PreviewRuntimeMessageEvent): PreviewRuntimeMessage | null {
    return this.#standby?.controller.handleMessage(event)
      ?? this.#current?.controller.handleMessage(event)
      ?? null;
  }

  snapshot(): PreviewSessionSnapshot {
    return {
      current: identityOf(this.#current?.document),
      standby: identityOf(this.#standby?.document),
      standbyReady: this.#standby?.ready ?? false,
      suspended: this.#suspended,
    };
  }

  #promote(managed: ManagedPreviewDocument): void {
    if (this.#standby !== managed) return;
    const previous = this.#current?.document ?? null;
    this.#current = managed;
    this.#standby = null;
    this.#callbacks.onPromoted?.(managed.document, previous);
    this.#emitSnapshot();
  }

  #emitSnapshot(): void {
    this.#callbacks.onSnapshotChanged?.(this.snapshot());
  }
}

function sameIdentity(
  left: PreviewRuntimeDocumentIdentity,
  right: PreviewRuntimeDocumentIdentity,
): boolean {
  return left.sessionId === right.sessionId && left.documentVersion === right.documentVersion;
}

function sameDocument(
  left: PreviewSessionDocument | undefined,
  right: PreviewSessionDocument,
): boolean {
  return left !== undefined && sameIdentity(left, right) && left.target === right.target;
}

function identityOf(
  document: PreviewSessionDocument | undefined,
): PreviewRuntimeDocumentIdentity | null {
  return document
    ? { sessionId: document.sessionId, documentVersion: document.documentVersion }
    : null;
}
