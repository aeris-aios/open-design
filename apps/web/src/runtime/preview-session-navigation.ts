import type { PreviewRuntimeDocumentIdentity } from '@open-design/contracts/runtime/preview-runtime';
import type { ProjectScopedPreviewNavigation } from '../providers/registry';

export interface PreviewSessionNavigation extends PreviewRuntimeDocumentIdentity {
  url: string;
  sandboxProfile: 'normal' | 'powered';
  deck: boolean;
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

export const NORMAL_PREVIEW_FRAME_SANDBOX = 'allow-scripts allow-downloads';
export const POWERED_PREVIEW_FRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-downloads allow-popups allow-forms allow-modals allow-pointer-lock';
export const POWERED_PREVIEW_FRAME_ALLOW =
  'accelerometer; autoplay; camera; cross-origin-isolated; fullscreen; gamepad; gyroscope; microphone; xr-spatial-tracking';

/** Bind browser privileges to the document profile chosen before navigation. */
export function previewSessionFramePolicy(
  sandboxProfile: PreviewSessionNavigation['sandboxProfile'],
): { sandbox: string; allow: string | undefined; powered: boolean } {
  return sandboxProfile === 'powered'
    ? {
        sandbox: POWERED_PREVIEW_FRAME_SANDBOX,
        allow: POWERED_PREVIEW_FRAME_ALLOW,
        powered: true,
      }
    : {
        sandbox: NORMAL_PREVIEW_FRAME_SANDBOX,
        allow: undefined,
        powered: false,
      };
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
  const deck = scoped.previewPolicy?.deck ?? policy.deck;
  const url = new URL(
    sandboxProfile === 'powered' ? scoped.poweredUrl : scoped.normalUrl,
  );

  if (sandboxProfile === 'normal') {
    if (guards.storage) url.searchParams.append('odPreviewBridge', 'sandbox');
    if (guards.focus) url.searchParams.append('odPreviewBridge', 'focus');
    if (guards.redirect) url.searchParams.append('odPreviewBridge', 'redirect');
  }
  if (deck) url.searchParams.append('odPreviewRuntime', 'deck');

  return {
    sessionId: scoped.sessionId,
    documentVersion: scoped.documentVersion,
    url: url.href,
    sandboxProfile,
    deck,
  };
}
