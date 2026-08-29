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
import {
  previewSessionFramePolicy,
  type PreviewSessionNavigation,
} from '../runtime/preview-session-navigation';
export type { PreviewSessionNavigation } from '../runtime/preview-session-navigation';
import type { PreviewRuntimeMessageTarget } from '../runtime/preview-runtime-controller';
import {
  PooledIframe,
  previewIframeKeepAliveKey,
  useIframeKeepAlivePool,
} from './IframeKeepAlivePool';

export interface PreviewSessionFramesProps extends Omit<
  ComponentPropsWithoutRef<'iframe'>,
  'src' | 'srcDoc' | 'onLoad' | 'ref' | 'sandbox' | 'allow'
> {
  projectId: string;
  fileName: string;
  navigation: PreviewSessionNavigation;
  enabledCapabilities?: readonly PreviewRuntimeCapability[];
  active: boolean;
  /** Bump to replace an unpromoted standby browsing context at the same URL. */
  navigationRetryToken?: number;
  onCurrentFrameChange?: (frame: HTMLIFrameElement | null) => void;
  onStandbyFrameChange?: (frame: HTMLIFrameElement | null) => void;
  onStandbyReady?: (frame: HTMLIFrameElement) => void;
  onCapabilitiesApplied?: (
    frame: HTMLIFrameElement,
    capabilities: readonly PreviewRuntimeCapability[],
  ) => void;
  onPromoted?: (
    current: PreviewSessionNavigation,
    previous: PreviewSessionNavigation | null,
  ) => void;
  onStandbyTimedOut?: (
    failed: PreviewSessionNavigation,
    current: PreviewSessionNavigation | null,
  ) => void;
  standbyTimeoutMs?: number;
}

interface RenderedPreviewDocument extends PreviewSessionNavigation {
  frame: HTMLIFrameElement;
  target: PreviewRuntimeMessageTarget;
}

const EMPTY_CAPABILITIES: readonly PreviewRuntimeCapability[] = [];
// The bootstrap is injected before author scripts and emits visible-paint
// after two animation frames. Standby frames remain paint-eligible while
// transparent, so five seconds bounds a broken runtime handshake without
// treating slow author resources as a successful preview.
export const PREVIEW_SESSION_STANDBY_TIMEOUT_MS = 5_000;

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
 * paints in a transparent, inert standby iframe. The component never assigns
 * about:blank and never mutates the URL of an existing browsing context.
 *
 * FileViewer consumes this adapter through its internal convergence harness,
 * while the default path stays unchanged until the legacy URL/srcDoc stack can
 * be replaced atomically.
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
  navigationRetryToken = 0,
  onCurrentFrameChange,
  onStandbyFrameChange,
  onStandbyReady,
  onCapabilitiesApplied,
  onPromoted,
  onStandbyTimedOut,
  standbyTimeoutMs = PREVIEW_SESSION_STANDBY_TIMEOUT_MS,
  title = fileName,
  ...iframeProps
}: PreviewSessionFramesProps) {
  const pool = useIframeKeepAlivePool();
  const callbacksRef = useRef({
    onCurrentFrameChange,
    onStandbyFrameChange,
    onStandbyReady,
    onCapabilitiesApplied,
    onPromoted,
    onStandbyTimedOut,
  });
  const frameByTargetRef = useRef(new Map<PreviewRuntimeMessageTarget, HTMLIFrameElement>());
  const standbyTargetRef = useRef<PreviewRuntimeMessageTarget | null>(null);
  callbacksRef.current = {
    onCurrentFrameChange,
    onStandbyFrameChange,
    onStandbyReady,
    onCapabilitiesApplied,
    onPromoted,
    onStandbyTimedOut,
  };
  const [current, setCurrent] = useState<RenderedPreviewDocument | null>(null);
  const [standbyFrame, setStandbyFrame] = useState<HTMLIFrameElement | null>(null);
  const [failedAttemptKey, setFailedAttemptKey] = useState<string | null>(null);
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
    // A cached scoped URL can execute the bootstrap during the child iframe's
    // layout effects, before this passive host listener exists. The bootstrap
    // answers probes idempotently, so repeat it only after the receive path is
    // live instead of relying on navigation timing.
    session.probe();
    return () => window.removeEventListener('message', handleMessage);
  }, [session]);

  useEffect(() => {
    for (const key of stalePoolKeysRef.current.splice(0)) pool.evict(key);
  });

  useEffect(() => () => {
    callbacksRef.current.onCurrentFrameChange?.(null);
  }, []);

  const requestedIsCurrent = sameIdentity(current, navigation);
  const requestedStandby = requestedIsCurrent ? null : navigation;
  const standbyAttemptKey = requestedStandby
    ? `${identityKey(requestedStandby)}\0retry:${navigationRetryToken}`
    : null;
  const standby = standbyAttemptKey !== null && failedAttemptKey === standbyAttemptKey
    ? null
    : requestedStandby;
  const previousNavigationRetryTokenRef = useRef(navigationRetryToken);

  useEffect(() => {
    if (
      !active
      || !standby
      || !standbyFrame
      || standbyTimeoutMs <= 0
      || standbyAttemptKey === null
    ) return undefined;
    const timeout = window.setTimeout(() => {
      session.discardStandby(standby);
      setFailedAttemptKey(standbyAttemptKey);
      callbacksRef.current.onStandbyTimedOut?.(
        standby,
        current ? navigationOf(current) : null,
      );
      pool.evictFrame(standbyFrame);
    }, standbyTimeoutMs);
    return () => window.clearTimeout(timeout);
  }, [
    active,
    current,
    pool,
    session,
    standby,
    standbyAttemptKey,
    standbyFrame,
    standbyTimeoutMs,
  ]);

  useEffect(() => {
    if (previousNavigationRetryTokenRef.current === navigationRetryToken) return;
    previousNavigationRetryTokenRef.current = navigationRetryToken;
    if (!standby) return;
    // Evicting the exact pooled key replaces only the unpromoted browsing
    // context. The PreviewSession ref callback discards its old message target
    // before the fresh frame stages the same document identity again.
    pool.evict(documentKeepAliveKey(projectId, fileName, standby));
  }, [fileName, navigationRetryToken, pool, projectId, standby]);

  const stageFrame = useCallback((frame: HTMLIFrameElement | null) => {
    setStandbyFrame(frame);
    if (!frame) {
      const previousTarget = standbyTargetRef.current;
      if (previousTarget) frameByTargetRef.current.delete(previousTarget);
      standbyTargetRef.current = null;
      if (standby) session.discardStandby(standby);
      callbacksRef.current.onStandbyFrameChange?.(null);
      return;
    }
    if (!standby) return;
    const target = frame.contentWindow;
    if (!target) return;
    standbyTargetRef.current = target;
    frameByTargetRef.current.set(target, frame);
    session.stageDocument({ ...standby, target });
    callbacksRef.current.onStandbyFrameChange?.(frame);
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
          sandbox={previewSessionFramePolicy(current.sandboxProfile).sandbox}
          allow={previewSessionFramePolicy(current.sandboxProfile).allow}
          data-od-powered={
            previewSessionFramePolicy(current.sandboxProfile).powered ? 'true' : undefined
          }
          data-testid="preview-runtime-frame-current"
          data-od-active={active ? 'true' : 'false'}
          aria-hidden={active ? undefined : 'true'}
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
          sandbox={previewSessionFramePolicy(standby.sandboxProfile).sandbox}
          allow={previewSessionFramePolicy(standby.sandboxProfile).allow}
          data-od-powered={
            previewSessionFramePolicy(standby.sandboxProfile).powered ? 'true' : undefined
          }
          data-testid="preview-runtime-frame-standby"
          data-od-active="false"
          data-od-standby="true"
          aria-hidden="true"
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
    sandboxProfile: document.sandboxProfile,
  };
}
