# packages/AGENTS.md

Follow the root `AGENTS.md` first. This file only records module-level boundaries for `packages/`.

## Package responsibilities

- `packages/agui-adapter`: pure TypeScript adapter between persisted OpenDesign agent/GenUI/plugin-pipeline events and the AG-UI event protocol. Keep transport and filesystem concerns out; daemon producers and web/CopilotKit consumers share this conversion boundary.
- `packages/contracts`: web/daemon app contract layer, including OpenDesign daemon/web sidecar DTOs and runtime projection. Keep it pure TypeScript; it must not depend on Next.js, Express, Node filesystem/process APIs, browser APIs, SQLite, daemon internals, or generic Sidecar transport internals.
- `packages/components`: shared React UI primitives and primitive CSS. It may depend on React types/runtime only; keep product workflows and app-specific layout/styling in the apps.
- `packages/diagnostics`: shared diagnostics export primitives for log collection, redaction, manifests, crash-report discovery, and zip packaging used by daemon and desktop.
- `packages/download`: managed-download runtime. Owns resumable and checksum-verified transfers, concurrent-request deduplication, target locking, inspection/removal, copy-and-clear, and pruning; callers supply the download identity and storage base.
- `packages/host`: web/desktop host bridge contract. It models renderer-facing host capabilities, desktop sidecar DTOs, and helpers while keeping `window.__od__` access out of app UI code.
- `packages/launcher-proto`: launcher protocol and path/state primitives. Owns channel/version/namespace validation, launcher directory derivation, runtime and cleanup descriptors, target selection, and after-quit argument parsing without owning launcher process orchestration.
- `packages/metatool`: internal metadata helpers for repo-local tool build outputs. Keep reusable hash/check/write mechanics here; each concrete tool owns its own `meta.json`.
- `packages/plugin-runtime`: pure TypeScript plugin manifest/marketplace parsers, source adapters, merge/ref resolution, validation, digesting, and pipeline-fallback selection. Daemon, web, and CI inject I/O rather than adding filesystem access here.
- `packages/registry-protocol`: pure TypeScript plugin-registry backend protocol and schemas. Owns backend list/search/resolve/manifest/doctor plus optional publish/yank interfaces, not concrete network or storage integrations.
- `packages/release`: pure release-domain primitives. Owns release channel names, version parsing/formatting, metadata field derivation, storage prefixes, release namespaces, and app identity data. It must not read/write files, call GitHub/R2, spawn build tools, or own workflow execution.
- `packages/sidecar`: generic atomic control-plane primitives. Includes owner bootstrap, existing-plane access, typed capabilities, opaque delegation, atomic launch/stop, and private transport; it must not hard-code OpenDesign services or business DTOs.
- `packages/platform`: generic OS process primitives and well-known user-toolchain bin discovery. It must not define a second sidecar identity, stamp, or lifecycle protocol. The toolchain helper is the single source of truth shared by the daemon runtime executable resolver (`apps/daemon/src/runtimes/executables.ts`) and packaged launchers so neither layer can drift the search list.

## Removed directories

- `packages/shared` has been removed; do not restore it.
- For new shared types, choose the boundary first: daemon/web DTOs go in `contracts`; desktop DTOs go in `host`; generic control-plane code goes in `sidecar`; generic OS/process code goes in `platform`.

## Boundary checklist

- Package tests live in each package's `tests/` directory, sibling to `src/`; keep `src/` source-only and do not add new `*.test.ts` or `*.test.tsx` files under `src/`.
- Keep cross-runtime DTO and plugin wire-shape validation schemas in `contracts` when callers need the same runtime parser, while keeping app-specific parsing, I/O, and enforcement in the owning app or package.
- App entrypoints may consume the public typed Sidecar control API, but product DTOs and validation must stay in `contracts`/`host`; private transport details stay in `sidecar`.
- Do not hard-code OpenDesign app/source/mode constants in `sidecar` or `platform`.

## Common package commands

```bash
pnpm --filter @open-design/agui-adapter typecheck
pnpm --filter @open-design/agui-adapter test
pnpm --filter @open-design/contracts typecheck
pnpm --filter @open-design/diagnostics typecheck
pnpm --filter @open-design/diagnostics test
pnpm --filter @open-design/download typecheck
pnpm --filter @open-design/download test
pnpm --filter @open-design/host typecheck
pnpm --filter @open-design/host test
pnpm --filter @open-design/launcher-proto typecheck
pnpm --filter @open-design/launcher-proto test
pnpm --filter @open-design/metatool typecheck
pnpm --filter @open-design/metatool test
pnpm --filter @open-design/plugin-runtime typecheck
pnpm --filter @open-design/plugin-runtime test
pnpm --filter @open-design/registry-protocol typecheck
pnpm --filter @open-design/registry-protocol test
pnpm --filter @open-design/release typecheck
pnpm --filter @open-design/release test
pnpm --filter @open-design/sidecar typecheck
pnpm --filter @open-design/sidecar test
pnpm --filter @open-design/platform typecheck
pnpm --filter @open-design/platform test
```
