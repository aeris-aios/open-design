# HTML preview runtime convergence

Status: active implementation plan  
Owner surface: `apps/web` FileViewer, `apps/daemon` project raw routes, preview runtime contracts  
Initial convergence PR: #7353

## Why this plan exists

HTML preview behavior accumulated several transports and recovery mechanisms:

- daemon-backed real URLs;
- `srcDoc` for host-injected interactive bridges;
- Blob/bootstrap transport for Electron navigation stability;
- powered real URLs for Worker, WASM, WebGL, and related capabilities;
- retained/pooled iframes, `about:blank` parking, transport generations, and reload recovery.

Each mechanism solved a real incident, but the combined state machine lets view changes,
capability changes, document updates, and navigation recovery affect one another. That is
the source of repeated white screens, reload flashes, stale frames, lost relative assets,
and difficult-to-prove recovery behavior.

This plan records the intended end state so follow-up work converges on one architecture
instead of adding another transport-specific fallback.

## End-state invariants

1. One settled file version is represented by one real daemon URL document.
2. View changes and capability changes never navigate that document.
3. Only a file-version change, explicit reload, eviction, or terminal recovery may navigate.
4. Every daemon-served HTML document receives one small bootstrap through bounded-memory
   streaming injection. File size does not disable bridges.
5. The daemon is the sole source of truth for passive guard detection and sandbox profile.
   The web client must not infer whole-file properties from a source prefix.
6. Relative CSS, JavaScript, JSX, fonts, media, `srcset`, dynamic imports, and nested paths
   resolve from the real file URL/scoped preview base; they are not host-inlined.
7. Interactive capabilities are negotiated over `postMessage`; enabling or disabling Deck,
   comment, inspect, edit, draw, snapshot, or observability does not replace the iframe.
8. The last visibly painted version remains visible until its replacement confirms visible
   paint. Loading and recovery must never expose an empty transport frame.
9. Recovery is navigation-token scoped, bounded, observable, and cannot loop indefinitely.
10. Inactive files are retained by an explicit LRU policy, not by transport-specific parking.

## Target state machines

### Document lifecycle

```text
COLD
  -> LOADING(url, version)
  -> READY(version)

READY(version)
  -> SUSPENDED                 view/file/project becomes inactive
  -> UPDATING(nextVersion)     file contents change
  -> COLD                      LRU eviction

SUSPENDED
  -> READY(version)            activation; no navigation
  -> UPDATING(nextVersion)     file changes while retained
  -> COLD                      LRU eviction

UPDATING(nextVersion)
  -> READY(nextVersion)        standby frame confirms visible paint; atomic swap
  -> READY(previousVersion)    bounded attempt fails; retain last-good document
  -> FAILED                    no last-good document exists

FAILED
  -> LOADING                   explicit retry or a newer file version
```

`Preview` to `Code`, file-tab changes, and project-tab changes only move between
`READY` and `SUSPENDED`. They must not set the document URL to `about:blank`.

### Capability lifecycle

```text
BOOTSTRAP_CONNECTING
  -> CONNECTED
  -> CONNECTED { deck, comment, inspect, edit, draw, snapshot, observability }
```

Capability sets are idempotent host messages. The iframe bootstrap installs or activates
the requested modules in its own DOM environment and acknowledges the resulting set.
Capability transitions are independent of the document lifecycle.

### Retention lifecycle

Each preview session is keyed by `(workspace, project, file)` and has one of:

- `ACTIVE`: visible and interactive;
- `SUSPENDED`: mounted, hidden, and immediately reusable;
- `EVICTED`: unmounted because the LRU budget was exceeded.

Temporary standby frames used for version replacement do not count as durable sessions and
must be retired immediately after the swap or failed attempt.

## Server response model

The daemon raw route performs one bounded-memory streaming scan and emits:

1. the artifact's original prefix;
2. a scoped `<base>` when the artifact has not authored one;
3. the universal bootstrap;
4. the remainder of the original file byte stream.

The scan determines passive policy such as:

- normal versus powered sandbox profile;
- storage/sandbox shim requirement;
- load-time focus protection;
- redirect-loop protection.

The browser still loads all authored subresources normally. The daemon must not buffer the
whole document or inline project assets merely to install a bridge.

## Migration phases

### Phase 1 — large-file real URL and passive guards

Initial PR: #7353.

- Stream bridge/bootstrap injection for HTML above the former buffering limit.
- Preserve range, HEAD, scoped preview-base, and authorization behavior.
- Keep relative external CSS/JS/JSX on real URLs.
- Make daemon scan results authoritative for powered mode and passive guards, including
  signals after the web routing prefix.
- Retain existing interactive `srcDoc` behavior until equivalent URL capabilities exist.

Exit gate: packaged Electron tests cover small and >2 MiB HTML, late guard signals,
`support.js`, many relative JSX files, relative CSS/media, file-tab/view/project switching,
and no unbounded recovery.

### Phase 2 — universal URL bootstrap

- Define a versioned bootstrap handshake and capability-set contract in
  `packages/contracts`.
- Move Deck, comment/selection, inspect, edit, palette/tweaks, draw, snapshot, and
  observability activation into the URL-loaded document.
- Run DOM annotation and bridge installation inside the iframe; the daemon does not need a
  full DOM parser for those capabilities.
- Keep source patching, authorization, persistence, and history in the host/daemon.

Exit gate: every existing interactive behavior has red/green parity tests against its
current product behavior, including slide sidebar retention and edit-without-reload.

### Phase 3 — PreviewSession and atomic version replacement

- Introduce a session owner keyed by `(workspace, project, file)`.
- Make Preview/Code and tab switches visibility-only operations.
- Introduce an explicit LRU budget for suspended sessions.
- Load changed versions in a temporary standby frame and swap only after visible-paint
  acknowledgement; retain the last-good frame on failure.
- Scope failure/retry state to a navigation token and cap retries.

Exit gate: high-frequency switches, edits during inactivity, project switching, and agent
file rewrites preserve the latest version without flashes, stale content, scroll loss, or
toolbar churn.

### Phase 4 — remove legacy transports

- Remove Blob/bootstrap main-preview transport.
- Remove `srcDoc` as a settled-file preview transport.
- Remove transport activation generations and `about:blank` parking.
- Remove web-side whole-file guard heuristics and asset-inlining/rewrite pipelines that only
  exist for Blob/srcDoc.
- Remove per-generation reload latches and transport-specific white-screen recovery branches.
- Update `docs/architecture.md` only after the old path is deleted and the new invariants are
  enforced by tests.

## Required regression matrix

Every phase must keep focused unit/integration tests and packaged Electron coverage for:

- first project open; project switch away/back; personal and team projects;
- Preview/Code switching and rapid file-tab switching;
- small HTML and large HTML well beyond 2 MiB;
- relative and nested CSS, JavaScript, modules, JSX/Babel, fonts, images, `srcset`, media,
  dynamic imports, and `support.js`;
- Deck sidebar/direct-page navigation, notes, keyboard controls, and cover sizing;
- comment selection, inspect, draw, snapshot/export, palette/tweaks, and manual editing;
- edit persistence, agent rewrites, file-watch bursts, undo/redo, and scroll preservation;
- powered Worker/WASM/WebGL previews;
- focus, storage, redirects, malformed tags, authored `<base>`, CSP, and sandbox behavior;
- slow subresources, aborted/stale navigation, retries, LRU eviction, and process restart;
- diagnostics and PostHog signals without artifact source or DOM text.

## Non-goals and rollout rules

- Do not turn every passive guard on globally; focus and redirect guards intentionally alter
  authored behavior and must follow daemon policy.
- Do not combine Phase 2 or Phase 3 with an unrelated user-facing feature.
- Do not delete an old transport until every capability it owns has parity coverage on the
  URL path.
- Do not treat browser-only tests as sufficient. Each migration phase requires a packaged
  Electron build installed and exercised with real multi-file artifacts.
- Do not add another transport fallback to fix an isolated incident. If a failure cannot be
  represented in these state machines, update this plan before implementing it.
