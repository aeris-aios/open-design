import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectScopedPreviewNavigation } from '../providers/registry';
import {
  PROJECT_PREVIEW_NAVIGATION_REFRESH_AHEAD_MS,
  projectPreviewNavigationCache,
  type ProjectPreviewNavigationRequest,
} from './project-preview-navigation-cache';
import {
  buildPreviewSessionNavigation,
  type PreviewSessionNavigation,
  type PreviewSessionNavigationPolicy,
} from './preview-session-navigation';

interface ProjectPreviewNavigationSource {
  get(
    request: ProjectPreviewNavigationRequest,
  ): Promise<ProjectScopedPreviewNavigation | null>;
}

export interface UseProjectPreviewSessionNavigationOptions
  extends ProjectPreviewNavigationRequest {
  policy: PreviewSessionNavigationPolicy;
  enabled?: boolean;
  /** Keep the same owner's last-good document visible while minting is paused. */
  retainLastGoodWhenDisabled?: boolean;
  /** Optional stable test/provider override. Do not recreate it during render. */
  cache?: ProjectPreviewNavigationSource;
  now?: () => number;
  refreshAheadMs?: number;
}

export interface ProjectPreviewSessionNavigationState {
  navigation: PreviewSessionNavigation | null;
  loading: boolean;
  unavailable: boolean;
  expiresAt: number | null;
}

interface LoadedNavigationState extends ProjectPreviewSessionNavigationState {
  ownerKey: string;
  loadKey: string | null;
  scoped: ProjectScopedPreviewNavigation | null;
  renewalFailures: number;
}

const EMPTY_STATE: LoadedNavigationState = {
  ownerKey: '',
  loadKey: null,
  scoped: null,
  navigation: null,
  loading: false,
  unavailable: false,
  expiresAt: null,
  renewalFailures: 0,
};

const RENEWAL_RETRY_BASE_MS = 1_000;
const RENEWAL_RETRY_MAX_MS = 30_000;

function stableKey(parts: readonly string[]): string {
  return parts.join('\0');
}

function sameNavigation(
  left: PreviewSessionNavigation | null,
  right: PreviewSessionNavigation,
): boolean {
  return left?.sessionId === right.sessionId
    && left.documentVersion === right.documentVersion
    && left.url === right.url
    && left.sandboxProfile === right.sandboxProfile;
}

/**
 * Resolve and renew the exact real-URL navigation for one FileViewer slot.
 *
 * A revision update retains the previous navigation while the replacement is
 * being minted, allowing PreviewSession to keep last-good content visible.
 * Project, file, or authorization changes fail closed and never expose the
 * previous owner's scoped URL.
 */
export function useProjectPreviewSessionNavigation({
  projectId,
  fileName,
  revisionKey,
  authorizationKey,
  policy,
  enabled = true,
  retainLastGoodWhenDisabled = false,
  cache = projectPreviewNavigationCache,
  now = Date.now,
  refreshAheadMs = PROJECT_PREVIEW_NAVIGATION_REFRESH_AHEAD_MS,
}: UseProjectPreviewSessionNavigationOptions): ProjectPreviewSessionNavigationState {
  const ownerKey = stableKey([authorizationKey, projectId, fileName]);
  const policyKey = stableKey([
    policy.sandboxProfile,
    policy.guards.storage ? 'storage' : '',
    policy.guards.focus ? 'focus' : '',
    policy.guards.redirect ? 'redirect' : '',
    policy.deck ? 'deck' : '',
  ]);
  const stablePolicy = useMemo<PreviewSessionNavigationPolicy>(() => ({
    sandboxProfile: policy.sandboxProfile,
    guards: {
      storage: policy.guards.storage,
      focus: policy.guards.focus,
      redirect: policy.guards.redirect,
    },
    deck: policy.deck,
  }), [
    policy.deck,
    policy.guards.focus,
    policy.guards.redirect,
    policy.guards.storage,
    policy.sandboxProfile,
  ]);
  const loadKey = stableKey([ownerKey, revisionKey, policyKey]);
  const request = useMemo<ProjectPreviewNavigationRequest>(() => ({
    projectId,
    fileName,
    revisionKey,
    authorizationKey,
  }), [authorizationKey, fileName, projectId, revisionKey]);
  const requestGenerationRef = useRef(0);
  const [state, setState] = useState<LoadedNavigationState>(EMPTY_STATE);

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    if (!enabled) {
      setState((previous) => previous.ownerKey === ownerKey
        ? {
            ...previous,
            loadKey: null,
            scoped: null,
            loading: false,
            unavailable: false,
            renewalFailures: 0,
          }
        : { ...EMPTY_STATE, ownerKey });
      return;
    }

    setState((previous) => previous.ownerKey === ownerKey
      ? {
          ...previous,
          loadKey: null,
          scoped: null,
          loading: true,
          unavailable: false,
          expiresAt: null,
          renewalFailures: 0,
        }
      : { ...EMPTY_STATE, ownerKey, loading: true });

    void cache.get(request).then((scoped) => {
      if (requestGenerationRef.current !== generation) return;
      if (!scoped) {
        setState((previous) => ({
          ...previous,
          ownerKey,
          loadKey,
          scoped: null,
          loading: false,
          unavailable: true,
          expiresAt: null,
          renewalFailures: 0,
        }));
        return;
      }
      const navigation = buildPreviewSessionNavigation(scoped, stablePolicy);
      setState((previous) => ({
        ownerKey,
        loadKey,
        scoped,
        navigation: sameNavigation(previous.navigation, navigation)
          ? previous.navigation
          : navigation,
        loading: false,
        unavailable: false,
        expiresAt: scoped.renewalScope.expiresAt,
        renewalFailures: 0,
      }));
    }).catch(() => {
      if (requestGenerationRef.current !== generation) return;
      setState((previous) => ({
        ...previous,
        ownerKey,
        loadKey,
        scoped: null,
        loading: false,
        unavailable: true,
        expiresAt: null,
        renewalFailures: 0,
      }));
    });

    return () => {
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current += 1;
      }
    };
  }, [cache, enabled, loadKey, ownerKey, request, stablePolicy]);

  useEffect(() => {
    if (
      !enabled
      || state.ownerKey !== ownerKey
      || state.loadKey !== loadKey
      || !state.scoped
    ) return;
    const delay = state.renewalFailures > 0
      ? Math.min(
          RENEWAL_RETRY_MAX_MS,
          RENEWAL_RETRY_BASE_MS * (2 ** Math.min(state.renewalFailures - 1, 5)),
        )
      : Math.max(
          0,
          state.scoped.renewalScope.expiresAt - now() - Math.max(0, refreshAheadMs),
        );
    const generation = requestGenerationRef.current;
    const timer = window.setTimeout(() => {
      void cache.get(request).then((scoped) => {
        if (requestGenerationRef.current !== generation) return;
        if (!scoped) {
          setState((previous) => previous.ownerKey === ownerKey
            && previous.loadKey === loadKey
            ? {
                ...previous,
                unavailable: true,
                renewalFailures: previous.renewalFailures + 1,
              }
            : previous);
          return;
        }
        const navigation = buildPreviewSessionNavigation(scoped, stablePolicy);
        setState((previous) => {
          if (previous.ownerKey !== ownerKey || previous.loadKey !== loadKey) return previous;
          const needsAnotherAttempt = scoped.renewalScope.expiresAt
            <= now() + Math.max(0, refreshAheadMs);
          return {
            ...previous,
            scoped,
            navigation: sameNavigation(previous.navigation, navigation)
              ? previous.navigation
              : navigation,
            unavailable: false,
            expiresAt: scoped.renewalScope.expiresAt,
            renewalFailures: needsAnotherAttempt ? previous.renewalFailures + 1 : 0,
          };
        });
      }).catch(() => {
        if (requestGenerationRef.current !== generation) return;
        setState((previous) => previous.ownerKey === ownerKey
          && previous.loadKey === loadKey
          ? {
              ...previous,
              unavailable: true,
              renewalFailures: previous.renewalFailures + 1,
            }
          : previous);
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [cache, enabled, loadKey, now, ownerKey, refreshAheadMs, request, stablePolicy, state]);

  if (!enabled) {
    if (retainLastGoodWhenDisabled && state.ownerKey === ownerKey) {
      return {
        navigation: state.navigation,
        loading: false,
        unavailable: false,
        expiresAt: state.expiresAt,
      };
    }
    return EMPTY_STATE;
  }
  if (state.ownerKey !== ownerKey) {
    return { navigation: null, loading: true, unavailable: false, expiresAt: null };
  }
  return {
    navigation: state.navigation,
    loading: state.loading,
    unavailable: state.unavailable,
    expiresAt: state.expiresAt,
  };
}
