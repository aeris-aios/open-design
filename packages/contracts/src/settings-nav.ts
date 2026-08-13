// Names of the Settings destinations that non-UI surfaces send users to.
//
// The daemon's provider errors and the agent's system prompt both tell users
// where to go and fix something ("configure it in Settings"). Those strings are
// written far away from the Settings dialog, so they drift: an error kept
// pointing at a section called "Media" long after the nav item was renamed, and
// users hunting for it found nothing (V0.19.1 acceptance bug recvre8FrTE2Oa).
//
// Every such destination must be spelled here, once, and every producer must
// read it from here rather than inlining its own guess. Each constant's value
// is the ENGLISH label rendered by the Settings nav, so it stays verifiable:
// `e2e/tests/settings/settings-nav-copy.test.ts` asserts each one still equals
// the `apps/web/src/i18n/locales/en.ts` key named in its docblock, and fails
// the build when the UI is renamed without updating this file.
//
// These are English labels. A localized client renders the same section under
// its own translation, so a destination quoted to the user in another language
// should be the translation of this label, not this literal.

/** The Settings nav item where media/API-generation credentials are entered — `settings.mediaProviders`. */
export const SETTINGS_MEDIA_PROVIDERS = 'Media providers';

/** The Settings nav item where external MCP servers are added/reconnected — `settings.externalMcpTitle`. */
export const SETTINGS_EXTERNAL_MCP = 'External MCP';

/** How a Settings destination is written when pointing a user at it: `Settings → Media providers`. */
export function settingsPath(section: string): string {
  return `Settings → ${section}`;
}

/** `Settings → Media providers` — the destination for every missing-credential error. */
export const SETTINGS_MEDIA_PROVIDERS_PATH = settingsPath(SETTINGS_MEDIA_PROVIDERS);

/** `Settings → External MCP` — the destination for MCP auth failures. */
export const SETTINGS_EXTERNAL_MCP_PATH = settingsPath(SETTINGS_EXTERNAL_MCP);
