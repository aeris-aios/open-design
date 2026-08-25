import type { PreviewRuntimeDocumentIdentity } from '@open-design/contracts/runtime/preview-runtime';
import type { ProjectScopedPreviewNavigation } from '../providers/registry';

export interface PreviewSessionNavigation extends PreviewRuntimeDocumentIdentity {
  url: string;
}

export interface PreviewSessionNavigationPolicy {
  sandboxProfile: 'normal' | 'powered';
  guards: {
    storage: boolean;
    focus: boolean;
    redirect: boolean;
  };
  deck: boolean;
}

/**
 * Select the one real document URL for an exact preview version.
 *
 * Only navigation policy belongs in this URL. Interactive modes such as edit,
 * comment, inspect, draw, Tweaks, and palette are negotiated with the loaded
 * runtime and must never cause a document navigation.
 */
export function buildPreviewSessionNavigation(
  scoped: ProjectScopedPreviewNavigation,
  policy: PreviewSessionNavigationPolicy,
): PreviewSessionNavigation {
  const url = new URL(
    policy.sandboxProfile === 'powered' ? scoped.poweredUrl : scoped.normalUrl,
  );

  if (policy.sandboxProfile === 'normal') {
    if (policy.guards.storage) url.searchParams.append('odPreviewBridge', 'sandbox');
    if (policy.guards.focus) url.searchParams.append('odPreviewBridge', 'focus');
    if (policy.guards.redirect) url.searchParams.append('odPreviewBridge', 'redirect');
  }
  if (policy.deck) url.searchParams.append('odPreviewRuntime', 'deck');

  return {
    sessionId: scoped.sessionId,
    documentVersion: scoped.documentVersion,
    url: url.href,
  };
}
