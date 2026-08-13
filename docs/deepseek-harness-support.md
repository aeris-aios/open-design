# DeepSeek Harness support evaluation

Status: accepted design with initial runtime scaffold; installer/UI work pending

Open Design baseline: `release/v0.19.1` at `2cedfa9e5495dccd018b7c22a88f6afb6c89bef7`

Evidence checked: 2026-08-13

## Recommendation

Add DeepSeek Harness as a new, deliberately small local runtime adapter. Detect
the official `dsh` executable, validate a tested prerelease version, and invoke
the official headless one-shot profile. Keep it distinct from the existing
`deepseek` adapter, which integrates the unrelated DeepSeek TUI / CodeWhale
project.

Ship the work in two coherent slices:

1. Core support: read-only detection, strict version gating, one-shot execution,
   actionable installation/auth diagnostics, and rescan.
2. Best-effort installation: an explicit user action that installs a pinned
   official npm package into Open Design-owned runtime storage, verifies it,
   and atomically promotes it. It must be available through the same daemon API
   from both Web and `od` CLI.

Do not silently run `npx`, install globally, elevate privileges, modify an
existing user installation, or use the repository's ACP demo packages. Those
choices either mutate during detection, depend on the network at execution
time, risk polluting user state, or target a reference/demo interface rather
than the product entry point.

## Scope

The supported journey is intentionally narrow:

1. Find a user-installed official DeepSeek Harness CLI.
2. Prove that the executable is invocable and its version is supported.
3. Run one Open Design task in the invoking project directory.
4. Surface the final assistant text and the process result.
5. If the CLI is absent, explain the official package and offer a bounded,
   explicit best-effort installation.
6. Fail quickly and safely when any prerequisite is not met.

The first implementation does not promise model selection, session resume,
mid-turn input, MCP injection, images, structured tool events, or the Harness
Web UI. The adapter must not simulate capabilities the upstream CLI does not
expose on its headless interface.

## Upstream facts

- The official repository is
  [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).
- The official npm package is
  [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh), which
  publishes the `dsh` executable.
- On 2026-08-13, npm `latest` and `next` both resolved to `0.1.0-rc.6`.
- The upstream README labels the project a developer preview and explicitly
  warns that compatibility-breaking changes will occur.
- The repository declares Node `^22.19.0 || >=24.0.0`. The published CLI
  package did not expose an `engines`, `os`, or `cpu` field in the registry
  metadata checked on the same date, so Open Design cannot rely on npm to
  reject an incompatible Node runtime.
- The documented one-shot product interface is:

  ```text
  dsh --profile headless "run the tests"
  ```

  It creates a fresh persisted Harness agent/session, treats the invoking
  directory as the workspace root, waits for the run to settle, prints the
  final non-empty assistant text to stdout, and exits `0` only for a completed
  turn. It does not start the Harness HTTP server.
- The `headless` profile auto-initializes under `DSH_HOME` on first use. That is
  expected runtime mutation owned by Harness, not a valid detection probe.
- Credentials are owned by Harness. It resolves inherited environment and its
  own credential/config files, including `DEEPSEEK_API_KEY`; Open Design should
  not inspect those files to infer authentication state.
- The ACP packages in the repository describe themselves as automation demos
  or reference clients. They are not the supported product one-shot surface
  and are out of scope.

## Local evidence

An isolated install of `@deepseek-ai/dsh@0.1.0-rc.6` produced a working
`dsh`/`dsh.cmd`; `dsh --version` returned `0.1.0-rc.6`. The installed tree was
approximately 257 MB and 33,000 entries. This is too large to describe as an
instant helper download and is a reason to make installation explicit,
cancelable, and recoverable.

The installed headless entry point behaved as follows:

- missing task: exit `1` with an actionable usage error;
- missing DeepSeek credential: exit `1` in about 1.4 seconds with
  `MISSING_CREDENTIAL` and `no API key` in stderr;
- version probe: exit `0` and print only the version;
- help/headless startup: materially slower than the version probe and capable
  of first-use profile initialization.

Focused upstream built-binary tests also passed for the headless positional
task, launcher help/usage routing, and the guarantee that `--version` does not
load a project `.env`.

## Runtime adapter

Use a new identity so the two DeepSeek integrations cannot collide:

| Field | Proposed value |
| --- | --- |
| id | `deepseek-harness` |
| display name | `DeepSeek Harness` |
| executable | `dsh` |
| binary override | `DSH_BIN` |
| version probe | `dsh --version` |
| stream format | `plain` |
| models | `default` only |
| custom model | unsupported |
| prompt transport | positional argv |
| prompt budget | 30,000 UTF-8 bytes |

The invocation must contain two option terminators:

```text
dsh --profile headless -- -- <composed-prompt>
```

The first `--` terminates the launcher parser and is consumed before arguments
reach the profile. The second terminates the headless app parser. Without both,
a prompt beginning with `-h`, `--help`, or another option-shaped token can
change control flow instead of being treated as user data.

The existing plain-output path is a good fit because Harness emits only its
final assistant text. The adapter should not claim streaming tool activity.
Open Design's existing exact-path spawning, Windows `.cmd` handling, prompt
byte preflight, cancellation, and process-group termination can be reused.

## Detection and compatibility policy

Detection must remain read-only:

1. Resolve `DSH_BIN`, then the existing PATH and user toolchain search paths.
2. Spawn only the resolved executable with `--version`, in the neutral probe
   working directory, with the existing three-second bound.
3. Parse one strict semver-prerelease line.
4. Mark the adapter available only when the version is in the Open Design
   build's tested allowlist.

The first allowlist should contain `0.1.0-rc.5` and `0.1.0-rc.6`, the versions
whose relevant paths were exercised during this evaluation. The best-effort
installer should pin `0.1.0-rc.6`. A later Open Design release can expand or
replace the allowlist after repeating the contract tests. It must never follow
npm `latest` automatically while upstream promises breaking changes.

Open Design currently treats most nonzero, timed-out, or unreadable version
probes as "spawned" and therefore available with a null version. Preserve that
legacy behavior for existing adapters, but add an opt-in strict version policy
to `RuntimeAgentDef`. For DeepSeek Harness, timeout, nonzero exit, empty output,
unparseable output, and unsupported version all mean unavailable.

Add an `unsupported-version` diagnostic reason rather than collapsing this
case into `not-on-path`. The diagnostic should show the detected version, the
tested versions, and actions for docs/install/rescan. A valid user-provided
`DSH_BIN` remains authoritative, but it does not bypass compatibility checks.

Do not probe `dsh --profile headless --help`: it is slower, crosses into
profile startup, and may initialize user state.

## Installation experience

### Guidance

The unavailable card and CLI health output should link to the official GitHub
repository and npm package, name the required Node range, show the persistent
CLI command, and explain rescan:

```text
npm install --global @deepseek-ai/dsh@0.1.0-rc.6
dsh --version
```

This is Open Design's persistent-CLI setup using the official package. The
upstream top-level README currently demonstrates `npx @deepseek-ai/dsh web`,
not a global install, so the UI should not misquote the global command as an
upstream recommendation.

### Best-effort install

The safe implementation is a managed-prefix transaction, not a global npm
mutation:

1. Require an explicit Install action and display the version, approximate
   download/installed size, destination ownership, and cancel behavior.
2. Preflight a compatible Node runtime, an invocable npm client, free space,
   network permission, and absence of another install for the same adapter.
3. Install the exact package/version into a fresh staging directory derived
   from `RUNTIME_DATA_DIR`. Never accept a client-supplied package name,
   command, version, or destination.
4. Bound runtime and captured output; stream coarse progress; support cancel.
5. Run the staged executable with `--version` and apply the same strict
   allowlist.
6. Atomically promote the verified directory and record a small receipt.
7. Resolve `DSH_BIN` first. When no override exists, prefer a verified managed
   executable after the user has explicitly installed it through Open Design;
   otherwise probe the user's PATH installation. Report the selected source
   and any ignored incompatible PATH candidate rather than silently mixing
   versions, then rescan.
8. On any failure, remove only the validated staging directory. Leave the
   previous managed version and all user installations untouched.

If npm is absent or incompatible, quick-fail before creating staging and fall
back to copyable instructions. Never elevate. A terminal-launched global
`npm install -g` is smaller to implement but cannot guarantee rollback, may
overwrite a user-owned version, and may require elevation; it does not satisfy
the stated safe-failure boundary.

Because this is user-visible, repository policy requires one shared daemon API
with both Web and `od` CLI clients. A possible surface is an install endpoint
plus `od agent install deepseek-harness [--json]`; exact naming should follow
the CLI's existing command conventions during implementation. Detection and
health output should likewise remain API-backed rather than reimplemented in
the clients.

## Quick-fail matrix

| Condition | Detection/install behavior | Run behavior |
| --- | --- | --- |
| `dsh` absent | unavailable; official docs, install, rescan, `DSH_BIN` guidance | reject before spawn |
| invalid `DSH_BIN` | `configured-bin-invalid`; clear/fix override | reject before spawn |
| non-executable or broken shim | existing precise diagnostic | reject before spawn |
| version probe exceeds 3 s or exits nonzero | unavailable under strict policy | reject before spawn |
| version empty/unparseable | unavailable; no optimistic fallback | reject before spawn |
| version outside tested allowlist | `unsupported-version` | reject before spawn |
| incompatible Node or missing npm | keep manual guidance; installer creates nothing | installed user CLI may still be probed, but unsupported CLI version stays blocked |
| install canceled/fails | delete staging only; preserve prior/user installs | no newly managed binary becomes visible |
| prompt exceeds 30,000 UTF-8 bytes | n/a | reject before spawn with context-reduction guidance |
| option-shaped prompt | n/a | two `--` terminators keep it data-only |
| credentials missing | do not read Harness credential files during detection | classify `MISSING_CREDENTIAL` / `no API key` as `AGENT_AUTH_REQUIRED` with Harness guidance |
| profile initialization/config failure | detection remains unaffected | nonzero exit with bounded stderr tail and Harness docs |
| run hangs or user cancels | n/a | reuse process-group cancellation and inactivity bounds; do not use an aggressive first-output timeout because headless is silent until its final answer |
| exit `0` with empty stdout | n/a | treat as malformed success, not a successful empty design response |

The current generic auth classifier does not recognize the observed Harness
message (`MISSING_CREDENTIAL` plus `no API key`). Extend it with narrowly
bounded phrases and add a `deepseek-harness`-specific remediation message. Do
not infer authentication by reading `$DSH_HOME`.

## Expected implementation areas

The implementation is likely to touch these concerns; exact file names may
move as the branch evolves:

- daemon runtime definition, registry, executable override, install metadata,
  strict detection/version policy, auth/failure classification, and empty
  success validation;
- shared contracts for the new diagnostic/install request and result shapes;
- a local-request-guarded daemon installer endpoint and bounded managed-prefix
  installer;
- Web agent identity/icon/description, diagnostic actions, explicit install
  confirmation/progress, and rescan;
- `od` agent health/install commands using the same daemon endpoints;
- localized user-facing strings;
- runtime mock plus adapter, detection, prompt-budget, failure, installer,
  API, Web, and CLI tests.

The existing `deepseek` id, binary override, metadata, labels, and mock must
remain unchanged.

## Acceptance criteria

- A user-installed official `dsh` in every existing npm/PATH search location
  is detected without modifying Harness state.
- `DSH_BIN` works on Windows, macOS, and Linux and never aliases
  `DEEPSEEK_BIN`.
- Only an explicitly supported, parseable version is selectable.
- The adapter invokes exactly `--profile headless -- -- <prompt>` in the
  selected project directory and respects the 30 KB prompt limit.
- A mock successful run returns final text and exit `0`; a missing-key fixture
  yields `AGENT_AUTH_REQUIRED`; empty stdout cannot become success.
- `-h`, `--help`, `--profile`, and whitespace-leading option-shaped prompts
  are delivered as prompt text, never parsed as flags.
- Detection never invokes a profile or loads project credentials.
- Install is explicit, pinned, local-request guarded, bounded, cancelable,
  staged, verified, and atomic; every failed path leaves user installations
  and the prior managed version unchanged.
- Web and `od --json` expose the same install/diagnostic result through the
  daemon API.
- Unsupported platforms, missing npm, incompatible Node, insufficient space,
  concurrent install, network failure, verification failure, and cancellation
  all produce a specific bounded failure rather than hanging or falling back
  to an unverified executable.

## Shared-branch development contract

The `deepseek-harness-support` branch is the single integration branch and PR
source. Parallel work stays on the headless transport and divides by ownership,
not by inventing a second protocol:

| Lane | Primary ownership | Merge contract |
| --- | --- | --- |
| Runtime core | `apps/daemon/src/runtimes/` and focused daemon tests | `deepseek-harness` definition, strict version gate, diagnostics, execution |
| macOS cold start | real macOS observations plus additions to `deepseek-harness.test.ts` or a dedicated runtime contract test | no API key in fixtures; assert argv, cwd, exit, timing class, and cancellation |
| Managed install | future runtime service, daemon API, contracts, Web and `od` CLI | pinned managed-prefix transaction; no global npm or `npx` fallback |

Before starting parallel work, pull the branch and run:

```text
pnpm install
pnpm --dir apps/daemon exec vitest run -c vitest.config.ts tests/runtimes/deepseek-harness.test.ts
pnpm --filter @open-design/daemon typecheck
```

The macOS lane should use Node 24, an isolated npm prefix, a fresh temporary
`DSH_HOME`, and `@deepseek-ai/dsh@0.1.0-rc.6`. Record only bounded stdout/stderr
shape, exit status, architecture, cold/warm duration, cwd behavior, and signal
shutdown; never commit credentials, complete prompts, user paths, or Harness
session state. A real-provider success check is optional and remains local.

Commits should stay lane-scoped and be pushed before another lane rebases. Any
change to the frozen executable, argv, supported-version set, or transport must
be discussed first because all lanes build on that contract. JSON-RPC remains
a future migration path only after DeepSeek publishes a product ACP CLI entry.

## Go/no-go

Go for the minimal adapter and strict detection work. The official headless
entry point maps cleanly to Open Design's plain one-shot runtime model.

Go for best-effort installation only with the managed-prefix transaction and
UI/CLI parity described above. If that implementation cost is not acceptable,
ship guidance and rescan but label installation as manual; do not substitute a
global or implicit `npx` mutation and call it safe best effort.
