import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type { PreviewRuntimeCapability } from '@open-design/contracts/runtime/preview-runtime';
import {
  previewRuntimeCapabilitiesForViewer,
  type PreviewRuntimeViewerState,
} from '../runtime/preview-runtime-capabilities';
import {
  replayPreviewBridgeModes,
  type PreviewBridgeModeState,
} from '../runtime/replay-preview-bridge-modes';
import {
  PreviewSessionFrames,
  type PreviewSessionFramesProps,
} from './PreviewSessionFrames';

export interface PreviewRuntimeTransportProps extends Omit<
  PreviewSessionFramesProps,
  'enabledCapabilities' | 'onCapabilitiesApplied'
> {
  viewerState: PreviewRuntimeViewerState;
  bridgeModeState: PreviewBridgeModeState;
  onCapabilitiesApplied?: (
    frame: HTMLIFrameElement,
    capabilities: readonly PreviewRuntimeCapability[],
  ) => void;
}

/**
 * Compose the retained real-URL frame lifecycle with host-owned interaction
 * state. Capability acknowledgements are fenced to one exact document before
 * any matching mode payload is replayed; later mode changes only post messages
 * to the retained current frame and never mutate its URL.
 *
 * FileViewer does not consume this component yet. Keeping this boundary
 * isolated lets the terminal transport prove feature parity before the legacy
 * URL/srcDoc stack is removed in one cutover.
 */
export function PreviewRuntimeTransport({
  viewerState,
  bridgeModeState,
  active,
  onCurrentFrameChange,
  onCapabilitiesApplied,
  ...frameProps
}: PreviewRuntimeTransportProps) {
  const enabledCapabilities = useMemo(() => previewRuntimeCapabilitiesForViewer(viewerState), [
    viewerState.comment,
    viewerState.deck,
    viewerState.draw,
    viewerState.edit,
    viewerState.inspect,
  ]);
  const currentFrameRef = useRef<HTMLIFrameElement | null>(null);
  const retainedCurrentFrameRef = useRef<HTMLIFrameElement | null>(null);
  const appliedCapabilitiesRef = useRef(
    new WeakMap<HTMLIFrameElement, readonly PreviewRuntimeCapability[]>(),
  );
  const modeStateRef = useRef(bridgeModeState);
  const callbacksRef = useRef({ onCurrentFrameChange, onCapabilitiesApplied });
  modeStateRef.current = bridgeModeState;
  callbacksRef.current = { onCurrentFrameChange, onCapabilitiesApplied };

  const replayToFrame = useCallback((
    frame: HTMLIFrameElement,
    capabilities: readonly PreviewRuntimeCapability[],
  ) => {
    replayPreviewBridgeModes(frame.contentWindow, modeStateRef.current, capabilities);
  }, []);

  const handleCapabilitiesApplied = useCallback((
    frame: HTMLIFrameElement,
    capabilities: readonly PreviewRuntimeCapability[],
  ) => {
    appliedCapabilitiesRef.current.set(frame, capabilities);
    replayToFrame(frame, capabilities);
    callbacksRef.current.onCapabilitiesApplied?.(frame, capabilities);
  }, [replayToFrame]);

  const handleCurrentFrameChange = useCallback((frame: HTMLIFrameElement | null) => {
    currentFrameRef.current = frame;
    if (frame) {
      retainedCurrentFrameRef.current = frame;
      const appliedCapabilities = appliedCapabilitiesRef.current.get(frame);
      if (appliedCapabilities) replayToFrame(frame, appliedCapabilities);
    } else if (active) {
      retainedCurrentFrameRef.current = null;
    }
    callbacksRef.current.onCurrentFrameChange?.(frame);
  }, [active, replayToFrame]);

  useEffect(() => {
    const frame = currentFrameRef.current ?? retainedCurrentFrameRef.current;
    if (!frame) return;
    const appliedCapabilities = appliedCapabilitiesRef.current.get(frame);
    if (appliedCapabilities) replayToFrame(frame, appliedCapabilities);
  }, [
    bridgeModeState.active,
    bridgeModeState.commentEnabled,
    bridgeModeState.commentMode,
    bridgeModeState.editEnabled,
    bridgeModeState.editLiveStyles,
    bridgeModeState.inspectEnabled,
    bridgeModeState.selectedEditTargetId,
    bridgeModeState.workspaceActive,
    replayToFrame,
  ]);

  return (
    <PreviewSessionFrames
      {...frameProps}
      active={active}
      enabledCapabilities={enabledCapabilities}
      onCurrentFrameChange={handleCurrentFrameChange}
      onCapabilitiesApplied={handleCapabilitiesApplied}
    />
  );
}
