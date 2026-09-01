/**
 * What the daemon this client is talking to can actually do, as opposed to what
 * the client-side runtime looks like. Served per request and never persisted:
 * the same data dir can be opened by a desktop daemon on Monday and a headless
 * one on Tuesday, so a stored answer would be a stale claim.
 *
 * Optional so a newer client keeps working against an older daemon — treat an
 * absent field as "unknown", not as "false".
 */
export interface AppRuntimeCapabilities {
  /**
   * Whether the daemon can render deck slides off-screen — the capability
   * behind PPTX and screenshot-PDF export. Only the desktop sidecar injects
   * that renderer, so a headless or container deployment reports `false` and
   * those export routes answer 501.
   *
   * Deliberately NOT derivable from `packaged`: a packaged binary run as a
   * plain daemon still has no renderer.
   *
   * NOTE: this is no longer the gate for IMAGE export — see `imageExport`.
   */
  slideRenderer: boolean;
  /**
   * Whether POST /api/projects/:id/export/image can actually render. True when
   * the desktop slide renderer is present OR when the daemon has a headless
   * artifact exporter (a Chromium binary on a server deployment) — a strictly
   * wider set than `slideRenderer`.
   *
   * Optional so an older daemon's payload stays valid; an absent field means
   * "unknown", which callers must fail OPEN on (attempt the export and let the
   * route's own 501 be the authority) rather than read as `false`.
   */
  imageExport?: boolean;
}

export interface AppVersionInfo {
  version: string;
  channel: string;
  packaged: boolean;
  platform: string;
  arch: string;
  capabilities?: AppRuntimeCapabilities;
}

export interface AppVersionResponse {
  version: AppVersionInfo;
}
