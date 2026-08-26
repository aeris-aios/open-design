import type { PreviewRuntimeDocumentIdentity } from '@open-design/contracts/runtime/preview-runtime';
import type { ProjectScopedPreviewNavigation } from '../providers/registry';

export interface PreviewSessionNavigation extends PreviewRuntimeDocumentIdentity {
  url: string;
  sandboxProfile: 'normal' | 'powered';
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
  const sandboxProfile = scoped.previewPolicy?.sandboxProfile ?? policy.sandboxProfile;
  const guards = scoped.previewPolicy?.guards ?? policy.guards;
  const url = new URL(
    sandboxProfile === 'powered' ? scoped.poweredUrl : scoped.normalUrl,
  );

  if (sandboxProfile === 'normal') {
    if (guards.storage) url.searchParams.append('odPreviewBridge', 'sandbox');
    if (guards.focus) url.searchParams.append('odPreviewBridge', 'focus');
    if (guards.redirect) url.searchParams.append('odPreviewBridge', 'redirect');
  }
  if (policy.deck) url.searchParams.append('odPreviewRuntime', 'deck');

  return {
    sessionId: scoped.sessionId,
    documentVersion: scoped.documentVersion,
    url: url.href,
    sandboxProfile,
  };
}
