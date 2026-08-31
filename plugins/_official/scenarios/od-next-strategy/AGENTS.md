# `od-next-strategy` (OD Next V2 prompt assets)

This folder is **one half of a two-sided prompt implementation.** The other half
is `apps/daemon/src/prompts/`. Read
[`apps/daemon/src/prompts/AGENTS.md`](../../../../apps/daemon/src/prompts/AGENTS.md)
before changing anything here — it carries the fork point, the four variant axes,
and the host runtime contract table.

The short version: when a run carries an OD Next recipe, `composeSystemPrompt`
(`apps/daemon/src/prompts/system.ts:902`) returns early and **none** of the legacy
prompt stack is composed. Whatever a rule needs to say has to be said on both
sides, or it holds for only some runs.

## What is actually sent to the model

`assets/core-system-prompt.md`, `assets/general-orchestration.md`, and exactly one
`assets/task-profiles/<taskType>.md` are decoded and concatenated verbatim into the
prompt bundle (`apps/daemon/src/strategies/od-next/initial-prompt-bundle-service.ts`).

**Never write repository-maintenance notes, TODOs, or cross-references into those
files.** They reach the model as instructions. Maintenance notes go here instead.

Not everything OD Next contributes lives in this folder: stage atoms such as
`discovery-question-form` are TypeScript, in
`packages/contracts/src/prompts/od-next-strategy.ts:402`. When answering "where
does OD Next say X", check both places.

## The asset roster and the package hash

`apps/daemon/src/plugins/strategy-package.ts:158` builds an explicit list:

```
./open-design.json, ./SKILL.md,
assets.core.path, assets.orchestration.path,
<selected task profile>.path, assets.taskProfileMapping.path,
<selected profile>.resources[*].path
```

Only those files are read, and only those are hashed into the package identity.
Consequences:

- Adding a file the manifest does not declare (this `AGENTS.md`, for instance) has
  **zero** runtime effect — not read, not hashed.
- `open-design.json` and `SKILL.md` **are** in the roster. Editing either moves the
  package identity.
- Only the *selected* profile's `resources` join the roster, so one task type's
  resources changing does not move another task type's hash.
- Changing a task profile's body should come with a `version` bump on its entry in
  `open-design.json`.

## Adding content a task profile needs

Two shapes, both already in use:

- **Prompt text** → the profile's own `.md`.
- **Non-prompt files** (skeletons, shells, stylesheets) → declare a `resources`
  entry on that profile in `open-design.json`. `prototype` does this today with
  `assets/task-profiles/prototype/device-frames/*.html` and `layout.css`; they are
  staged into the project as `.od-frames/` and referenced by the profile, never
  concatenated into the prompt head.

Prefer the second shape when the legacy side already owns the same content as a
constant. Reference one source instead of copying it into markdown.

## Known gap

`assets/task-profiles/ppt.md` requires a "single-file HTML deck / openable and
pageable" but pins none of the deck protocol v1 markers the web viewer detects:
`data-od-deck-protocol="1"`, the `od:deck-ready` announce, `od:slide-state` posts,
the `od:slide` navigate listener, `id="deck-stage"`, and the `@media print` block
are all absent from this folder.

The legacy side ships all of them from one shared constant —
`DECK_PROTOCOL_V1_INLINE_RUNTIME` in
`packages/contracts/src/runtime/deck-protocol.ts`, embedded in the skeleton in
`apps/daemon/src/prompts/deck-framework.ts` and its API/BYOK mirror. A deck
generated on the OD Next path can therefore fail to be recognized as a v1 deck,
paged from the host toolbar, or exported to PDF. See the host runtime contract
table in `apps/daemon/src/prompts/AGENTS.md`.
