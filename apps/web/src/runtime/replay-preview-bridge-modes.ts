import { PREVIEW_OBSERVABILITY_HOST_STATE_MESSAGE_TYPE } from '@open-design/contracts/runtime/preview-observability';
import type { PreviewRuntimeCapability } from '@open-design/contracts/runtime/preview-runtime';
import type { PreviewRuntimeMessageTarget } from './preview-runtime-controller';

export interface PreviewEditLiveStyle {
  id: string;
  styles: unknown;
  version: number;
}

export interface PreviewBridgeModeState {
  active: boolean;
  workspaceActive: boolean;
  commentEnabled: boolean;
  commentMode: string;
  editEnabled: boolean;
  selectedEditTargetId: string | null;
  editLiveStyles: readonly PreviewEditLiveStyle[];
  inspectEnabled: boolean;
}

/**
 * Replay host-owned interaction state to one explicit preview document.
 *
 * `appliedCapabilities` is omitted for the legacy transports, preserving their
 * existing unconditional messages. The converged runtime passes its exact ack
 * so a mode payload is never sent before the matching module is installed.
 */
export function replayPreviewBridgeModes(
  target: PreviewRuntimeMessageTarget | null,
  state: PreviewBridgeModeState,
  appliedCapabilities?: readonly PreviewRuntimeCapability[],
): void {
  if (!target) return;
  const enabled = appliedCapabilities ? new Set(appliedCapabilities) : null;
  const supports = (capability: PreviewRuntimeCapability) => (
    enabled === null || enabled.has(capability)
  );

  if (supports('observability')) {
    target.postMessage({
      type: PREVIEW_OBSERVABILITY_HOST_STATE_MESSAGE_TYPE,
      active: state.active,
    }, '*');
  }
  if (!state.workspaceActive) return;

  if (supports('comment')) {
    target.postMessage({
      type: 'od:comment-mode',
      enabled: state.commentEnabled,
      mode: state.commentMode,
    }, '*');
  }
  if (supports('edit')) {
    target.postMessage({ type: 'od-edit-mode', enabled: state.editEnabled }, '*');
    target.postMessage({
      type: 'od-edit-selected-target',
      id: state.editEnabled ? state.selectedEditTargetId : null,
    }, '*');
    if (state.editEnabled) {
      for (const preview of state.editLiveStyles) {
        target.postMessage({
          type: 'od-edit-preview-style',
          id: preview.id,
          styles: preview.styles,
          version: preview.version,
        }, '*');
      }
    }
  }
  if (supports('inspect')) {
    target.postMessage({ type: 'od:inspect-mode', enabled: state.inspectEnabled }, '*');
  }
}
