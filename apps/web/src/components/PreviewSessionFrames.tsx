import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from 'react';
import type {
  PreviewRuntimeCapability,
  PreviewRuntimeDocumentIdentity,
} from '@open-design/contracts/runtime/preview-runtime';
import {
  PreviewSession,
  type PreviewSessionDocument,
} from '../runtime/preview-session';
import type { PreviewSessionNavigation } from '../runtime/preview-session-navigation';
export type { PreviewSessionNavigation } from '../runtime/preview-session-navigation';
import type { PreviewRuntimeMessageTarget } from '../runtime/preview-runtime-controller';
import {
  PooledIframe,
  previewIframeKeepAliveKey,
  useIframeKeepAlivePool,
} from './IframeKeepAlivePool';

export interface PreviewSessionFramesProps extends Omit<
  ComponentPropsWithoutRef<'iframe'>,
  'src' | 'srcDoc' | 'onLoad' | 'ref'
> {
  projectId: string;
  fileName: string;
  navigation: PreviewSessionNavigation;
  enabledCapabilities?: readonly PreviewRuntimeCapability[];
  active: boolean;
  onCurrentFrameChange?: (frame: HTMLIFrameElement | null) => void;
  onStandbyReady?: (frame: HTMLIFrameElement) => void;
  onCapabilitiesApplied?: (
    frame: HTMLIFrameElement,
    capabilities: readonly PreviewRuntimeCapability[],
  ) => void;
  onPromoted?: (
    current: PreviewSessionNavigation,
    previous: PreviewSessionNavigation | null,
  ) => void;
}

interface RenderedPreviewDocument extends PreviewSessionNavigation {
  frame: HTMLIFrameElement;
  target: PreviewRuntimeMessageTarget;
}

const EMPTY_CAPABILITIES: readonly PreviewRuntimeCapability[] = [];

function identityKey(identity: PreviewRuntimeDocumentIdentity): string {
  return `${identity.sessionId}\0${identity.documentVersion}`;
}

function sameIdentity(
  left: PreviewRuntimeDocumentIdentity | null,
  right: PreviewRuntimeDocumentIdentity,
): boolean {
  return left !== null && identityKey(left) === identityKey(right);
}

function documentKeepAliveKey(
  projectId: string,
  fileName: string,
  identity: PreviewRuntimeDocumentIdentity,
): string {
  return `${previewIframeKeepAliveKey(projectId, fileName)}\0${identityKey(identity)}`;
}

/**
 * Retain one last-good real-URL iframe while an exact new document version
 * paints in a hidden standby iframe. The component never assigns about:blank
 * and never mutates the URL of an existing browsing context.
 *
 * FileViewer does not consume this component yet. It is the isolated adapter
 * used to prove the final transport lifecycle before replacing the legacy
 * URL/srcDoc stack.
 */
export function PreviewSessionFrames({
  projectId,
  fileName,
  ...props
}: PreviewSessionFramesProps) {
  return (
    <PreviewSessionFramesForFile
      key={`${projectId}\0${fileName}`}
      projectId={projectId}
      fileName={fileName}
      {...props}
    />
  );
}

function PreviewSessionFramesForFile({
  projectId,
  fileName,
  navigation,
  enabledCapabilities = EMPTY_CAPABILITIES,
  active,
  onCurrentFrameChange,
  onStandbyReady,
  onCapabilitiesApplied,
  onPromoted,
  title = fileName,
  ...iframeProps
}: PreviewSessionFramesProps) {
  const pool = useIframeKeepAlivePool();
  const callbacksRef = useRef({
    onCurrentFrameChange,
    onStandbyReady,
    onCapabilitiesApplied,
    onPromoted,
  });
  const frameByTargetRef = useRef(new Map<PreviewRuntimeMessageTarget, HTMLIFrameElement>());
  const standbyTargetRef = useRef<PreviewRuntimeMessageTarget | null>(null);
  callbacksRef.current = {
    onCurrentFrameChange,
    onStandbyReady,
    onCapabilitiesApplied,
    onPromoted,
  };
  const [current, setCurrent] = useState<RenderedPreviewDocument | null>(null);
  const stalePoolKeysRef = useRef<string[]>([]);

  const session = useMemo(() => new PreviewSession({
    callbacks: {
      onStandbyReady(document) {
        const frame = frameByTargetRef.current.get(document.target);
        if (frame) callbacksRef.current.onStandbyReady?.(frame);
      },
      onCapabilitiesApplied(document, capabilities) {
        const frame = frameByTargetRef.current.get(document.target);
        if (frame) callbacksRef.current.onCapabilitiesApplied?.(frame, capabilities);
      },
      onPromoted(document, previous) {
        const frame = frameByTargetRef.current.get(document.target);
        if (!frame) return;
        const next = { ...document, frame };
        setCurrent(next);
        callbacksRef.current.onPromoted?.(
          navigationOf(document),
          previous ? navigationOf(previous) : null,
        );
        if (previous) {
          stalePoolKeysRef.current.push(documentKeepAliveKey(projectId, fileName, previous));
        }
      },
    },
  }), [fileName, projectId]);

  useEffect(() => {
    session.setEnabledCapabilities(enabledCapabilities);
  }, [enabledCapabilities, session]);

  useEffect(() => {
    session.setSuspended(!active);
    callbacksRef.current.onCurrentFrameChange?.(active ? current?.frame ?? null : null);
  }, [active, current, session]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => session.handleMessage(event);
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [session]);

  useEffect(() => {
    for (const key of stalePoolKeysRef.current.splice(0)) pool.evict(key);
  });

  useEffect(() => () => {
    callbacksRef.current.onCurrentFrameChange?.(null);
  }, []);

  const requestedIsCurrent = sameIdentity(current, navigation);
  const standby = requestedIsCurrent ? null : navigation;

  const stageFrame = useCallback((frame: HTMLIFrameElement | null) => {
    if (!frame) {
      const previousTarget = standbyTargetRef.current;
      if (previousTarget) frameByTargetRef.current.delete(previousTarget);
      standbyTargetRef.current = null;
      if (standby) session.discardStandby(standby);
      return;
    }
    if (!standby) return;
    const target = frame.contentWindow;
    if (!target) return;
    standbyTargetRef.current = target;
    frameByTargetRef.current.set(target, frame);
    session.stageDocument({ ...standby, target });
  }, [session, standby]);

  const retainCurrentFrame = useCallback((frame: HTMLIFrameElement | null) => {
    if (!current) return;
    if (!frame) {
      frameByTargetRef.current.delete(current.target);
      return;
    }
    frameByTargetRef.current.set(current.target, frame);
  }, [current]);

  const commonProps = {
    ...iframeProps,
    title,
    'data-od-render-mode': 'runtime-url',
  };

  return (
    <>
      {current ? (
        <PooledIframe
          key={documentKeepAliveKey(projectId, fileName, current)}
          {...commonProps}
          ref={retainCurrentFrame}
          cacheKey={documentKeepAliveKey(projectId, fileName, current)}
          src={current.url}
          data-testid="preview-runtime-frame-current"
          data-od-active={active ? 'true' : 'false'}
          aria-hidden={active ? undefined : true}
          tabIndex={active ? 0 : -1}
        />
      ) : null}
      {standby ? (
        <PooledIframe
          key={documentKeepAliveKey(projectId, fileName, standby)}
          {...commonProps}
          ref={stageFrame}
          cacheKey={documentKeepAliveKey(projectId, fileName, standby)}
          src={standby.url}
          data-testid="preview-runtime-frame-standby"
          data-od-active="false"
          aria-hidden
          tabIndex={-1}
        />
      ) : null}
    </>
  );
}

function navigationOf(document: PreviewSessionDocument): PreviewSessionNavigation {
  return {
    sessionId: document.sessionId,
    documentVersion: document.documentVersion,
    url: document.url,
  };
}
