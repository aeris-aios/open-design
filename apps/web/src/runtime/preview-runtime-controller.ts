import {
  createPreviewRuntimeSetCapabilitiesMessage,
  normalizePreviewRuntimeCapabilities,
  parsePreviewRuntimeMessage,
  previewRuntimeMessageMatchesDocument,
  type PreviewRuntimeCapability,
  type PreviewRuntimeDocumentIdentity,
  type PreviewRuntimeMessage,
} from '@open-design/contracts/runtime/preview-runtime';

export interface PreviewRuntimeMessageTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface PreviewRuntimeControllerCallbacks {
  onCapabilitiesApplied?: (capabilities: readonly PreviewRuntimeCapability[]) => void;
  onReady?: () => void;
  onVisiblePaint?: () => void;
}

export interface PreviewRuntimeMessageEvent {
  source: unknown;
  data: unknown;
}

/**
 * Host-side protocol state for one exact iframe document. It has no React
 * lifecycle of its own: PreviewSession will own the instance and feed window
 * message events to it while the corresponding frame is retained.
 */
export class PreviewRuntimeController {
  readonly #identity: PreviewRuntimeDocumentIdentity;
  readonly #target: PreviewRuntimeMessageTarget;
  readonly #callbacks: PreviewRuntimeControllerCallbacks;
  #available: PreviewRuntimeCapability[] | null = null;
  #desired: PreviewRuntimeCapability[];
  #lastCommandKey = '';

  constructor(options: {
    identity: PreviewRuntimeDocumentIdentity;
    target: PreviewRuntimeMessageTarget;
    enabledCapabilities?: readonly PreviewRuntimeCapability[];
    callbacks?: PreviewRuntimeControllerCallbacks;
  }) {
    this.#identity = options.identity;
    this.#target = options.target;
    this.#desired = normalizePreviewRuntimeCapabilities(options.enabledCapabilities ?? []);
    this.#callbacks = options.callbacks ?? {};
  }

  setEnabledCapabilities(capabilities: readonly PreviewRuntimeCapability[]): void {
    this.#desired = normalizePreviewRuntimeCapabilities(capabilities);
    this.#sendCapabilityCommand();
  }

  handleMessage(event: PreviewRuntimeMessageEvent): PreviewRuntimeMessage | null {
    if (event.source !== this.#target) return null;
    const message = parsePreviewRuntimeMessage(event.data);
    if (message === null || !previewRuntimeMessageMatchesDocument(message, this.#identity)) return null;

    switch (message.type) {
      case 'od:preview:hello':
        this.#available = message.availableCapabilities;
        this.#lastCommandKey = '';
        this.#sendCapabilityCommand();
        break;
      case 'od:preview:capabilities-applied':
        this.#callbacks.onCapabilitiesApplied?.(message.enabledCapabilities);
        break;
      case 'od:preview:ready':
        this.#callbacks.onReady?.();
        break;
      case 'od:preview:visible-paint':
        this.#callbacks.onVisiblePaint?.();
        break;
      case 'od:preview:set-capabilities':
        return null;
    }
    return message;
  }

  #sendCapabilityCommand(): void {
    if (this.#available === null) return;
    const desired = new Set(this.#desired);
    const enabledCapabilities = this.#available.filter((capability) => desired.has(capability));
    const commandKey = enabledCapabilities.join('\0');
    if (commandKey === this.#lastCommandKey) return;
    this.#lastCommandKey = commandKey;
    this.#target.postMessage(createPreviewRuntimeSetCapabilitiesMessage({
      ...this.#identity,
      enabledCapabilities,
    }), '*');
  }
}
