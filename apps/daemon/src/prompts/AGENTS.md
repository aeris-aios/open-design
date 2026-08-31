# `apps/daemon/src/prompts/` (system prompt composition)

Read this before changing ANY prompt text, in this directory or elsewhere.

## The one thing to know first

**A generation run is composed by one of two independent prompt
implementations, and this directory is only one of them.** The fork is an early
return at the top of `composeSystemPrompt`:

```ts
// apps/daemon/src/prompts/system.ts:902
}: ComposeInput): string {
  if (odNextStrategyRecipe) {
    return composeOdNextStrategyRequestPromptV2(odNextStrategyRecipe, {...});
  }
  // ↓ everything below — the entire legacy stack — is skipped on the OD Next path
```

`DECK_FRAMEWORK_DIRECTIVE` is pushed at `system.ts:1337` / `:1354`, i.e. **after**
that return, so a deck generated on the OD Next path receives none of it. The
same early return exists in the API/BYOK mirror at
`packages/contracts/src/prompts/system.ts:308`.

The two sides share no floor. Nothing merges. A rule added to one holds only for
the runs that take that side.

## Which runs take which path

OD Next is opt-in and gated. `evaluateOdNextRollout`
(`apps/daemon/src/strategies/od-next/rollout.ts:138`) is a nine-way AND, and three
of its inputs vary run to run on one machine — which is why divergence between
the two sides surfaces as an **intermittent** bug rather than a consistent one:

- **The stop latch** (`rollout.ts:469`, `stopModeForOdNextSignal`). One
  `threshold_exceeded` (a slow run) drops the installation to `observe`;
  `machine_contract_leak` drops it to `off`. The decision persists in SQLite while
  the Labs switch still reads "on".
- **Scenario provenance** (`rollout.ts:121`,
  `odNextTaskTypeForProjectScenarioBinding`) requires
  `provenance === 'automatic_default'`. A project where the user explicitly picked
  a scenario resolves `taskType` to null and takes the legacy path.
- `agentId` must be one of `codex` / `claude` / `opencode` / `amr`, `sourceKind`
  must be `bundled`, and the runtime capability preflight must have passed.

User-facing switch: Settings → Labs → Design Harness
(`apps/web/src/components/LabsSection.tsx`, reading
`GET /api/strategies/od-next/rollout`). Process override:
`OD_NEXT_STRATEGY_ROLLOUT`. Saved preference: app-config `odNextStrategyMode`.

## The four variant axes

Changing "the prompt" can mean up to four edits. Check each one:

| Axis | Switch | A side | B side |
|---|---|---|---|
| Strategy | `odNextStrategyRecipe` (`system.ts:902`) | this directory | `plugins/_official/scenarios/od-next-strategy/assets/**` |
| Legacy core | `OD_PROMPT_CORE` (`apps/daemon/src/server.ts:10029`) — **default is `slim`**, `classic` is the opt-out | `core-slim.ts` | `official-system.ts` + `discovery.ts` |
| Execution mode | none; hand-maintained mirror | `apps/daemon/src/prompts/*.ts` | `packages/contracts/src/prompts/*.ts` (API/BYOK) |
| OD Next internals | none; the same list is declared twice | `OD_NEXT_PROMPT_STAGE_CONTRACT_V2` (`packages/contracts/src/prompts/od-next-strategy.ts:182`) | `od.pipeline.stages` in the plugin's `open-design.json` |

Mirrored file pairs on the third axis: `system.ts`, `deck-framework.ts`,
`discovery.ts`, `directions.ts`, `media-contract.ts`, `official-system.ts`. They
have already drifted (`system.ts` differs by ~900 lines), so diffing the pair is
not a reliable way to find what a change is missing — use the contract table.

## Host runtime contracts

These are not style preferences. Each is consumed by product code, and a
generated artifact that omits one is not controllable by the host. They belong to
the **host**, not to either strategy — if a strategy is retired, these stay.

| Contract | Host consumer | Legacy | OD Next |
|---|---|---|---|
| `data-od-deck-protocol="1"` on `<html>` | `apps/web/src/runtime/srcdoc.ts:3136` — how the host recognizes a v1-native deck | ✅ `DECK_SKELETON_HTML` | ❌ **gap** |
| `od:deck-ready` announce (`protocolVersion`, `capabilities`) | `srcdoc.ts:4167` — the host ignores a ready message without `protocolVersion === 1` | ✅ via `DECK_PROTOCOL_V1_INLINE_RUNTIME` | ❌ **gap** |
| `od:slide-state` `{active, count}` posts | unified slide counter and toolbar state | ✅ same inline runtime | ❌ **gap** |
| `od:slide` navigate listener | host-driven paging (`next`/`prev`/`first`/`last`/`go`) | ✅ same inline runtime | ❌ **gap** |
| `id="deck-stage"` | `srcdoc.ts:3145` `isFrameworkDeck` → stage style fix, disables click-nav | ✅ | ❌ **gap** |
| `.slide` / `.slide.active` toggle | deck bridge class-toggle convention | ✅ | ❌ **gap** |
| `@media print` block | Share → PDF multi-page stitching | ✅ | ❌ **gap** |
| `<question-form>` | `apps/web/src/components/AssistantMessage.tsx:3149` → `QuestionFormView`; `runAskedUserQuestion` analytics | ✅ `discovery.ts:44` | ✅ but in TS, not markdown: `od-next-strategy.ts:402` |
| `.od-frames/` device shells | prototype device frames | ❌ | ✅ OD Next only |

Three things to read off this table.

**The deck protocol is already a first-class shared contract — OD Next is simply
outside it.** `packages/contracts/src/runtime/deck-protocol.ts` owns
`DECK_PROTOCOL_VERSION`, the three message types, and
`DECK_PROTOCOL_V1_INLINE_RUNTIME`. Both prompt copies import that one constant
(daemon via `@open-design/contracts/runtime/deck-protocol`, contracts via
`../runtime/deck-protocol.js`), and its docblock says why: keeping the protocol
in one literal "prevents the daemon and API/BYOK prompt copies from growing
different message dialects." That reasoning was never extended to the OD Next
side, which reaches the model through neither copy.

**The divergence runs both ways.** OD Next is not a superset of legacy; it owns
`.od-frames/` device shells that legacy has no equivalent for.

**OD Next content has two possible homes.** It already re-implements one host
contract (`<question-form>`) as a TypeScript atom rather than in its markdown
assets. Check both the plugin assets and `od-next-strategy.ts` before concluding
a contract is absent on that side.

## Editing rules

- **Changing a rule that affects generated artifacts?** Apply it to both strategy
  sides, or state in the PR body why one side is genuinely out of scope. "I'll do
  OD Next later" leaves the bug live for whichever runs take that path.
- **Adding a host contract?** Add its row to the table above in the same PR.
- **Prompt-facing vs. maintenance text.** Everything under
  `plugins/_official/scenarios/od-next-strategy/assets/` is sent to the model
  verbatim. Never put repository-maintenance notes there — put them in that
  folder's `AGENTS.md`, which is not part of the asset roster. In this directory
  the exported string is the prompt, so `/** */` docblocks above an export are
  safe.
- **A green suite is not evidence that both sides carry your change.**
  `apps/daemon/tests/prompts/system-prompt-matrix.test.ts` freezes which sections
  each scenario receives, but every one of its scenarios takes the legacy branch,
  so it cannot see an OD Next regression.

## Worked example: PR #7568

This is what going one-sided looks like when the author is careful. Read it
before assuming your own change is too small to have a second side.

`fix(deck): make legacy thumbnail navigation instant` (#7568, merged 2026-08-29,
`973e868ce`) introduced deck protocol v1: 18 files, +510/-44. Its stated purpose,
in its own PR body, was to give newly generated decks "one canonical, versioned
navigation protocol so future agents do not create more navigation dialects."

**What it got right — the daemon ↔ contracts axis, completely.** It added the
shared constant `packages/contracts/src/runtime/deck-protocol.ts` (+87) so the
two prompt copies cannot drift on the protocol, changed both
`apps/daemon/src/prompts/deck-framework.ts` and
`packages/contracts/src/prompts/deck-framework.ts` (+10 each), and added a
guard on each side: `apps/daemon/tests/prompts/system.test.ts` and
`packages/contracts/tests/system-prompt.test.ts` (+10 each). Validation ran
`pnpm guard`, `pnpm typecheck`, the full web (7,139 tests) and contracts (500)
suites, targeted deck suites, and two packaged DMG end-to-end runs against the
real reported deck. By every convention in this repository it was a thorough PR.

**What it missed — the strategy axis, entirely.** Not one file under
`plugins/_official/scenarios/`. Every deck generated on the OD Next path still
ships no protocol at all: the PR whose goal was to stop new navigation dialects
left one live. The gap was reported two days after merge.

Three things made the miss invisible, and all three are still true:

- **The guards it added cannot reach the other side.** Both new tests call
  `composeSystemPrompt({ skillMode: 'deck' })` with no `odNextStrategyRecipe`,
  so they never pass the fork. The daemon one is named
  `'ships new Agent decks with OD Deck Protocol v1'` — a claim about Agent decks
  that is false for every OD Next run, asserted by a test that is green. A test
  name is not coverage; check what its inputs can actually reach.
- **The snapshot moved and stayed green.**
  `apps/daemon/tests/prompts/__snapshots__/system-prompt-matrix.test.ts.snap`
  updated cleanly, because every scenario in that matrix takes the legacy branch.
- **Sharing a constant fixes the machine-readable half only.** The two copies'
  surrounding directive prose had already drifted before #7568 and still differs
  on `origin/main`: the daemon copy advertises "hidden programmatic" chrome,
  "R reset-to-first-slide", and "half-slide click navigation"; the contracts copy
  advertises "click-anywhere focus" instead. #7568 inserted the same new clause
  into both, faithfully — into two sentences that already disagreed. The
  protocol markers are guarded; the prose around them is not.

The transferable rule: before landing a change to generated-artifact behavior,
name every path that composes a prompt, then say for each one whether your change
reaches it. "The tests are green" answers a narrower question than that.

## Known gaps

Verified on `9130ea94e` (2026-08-31).

- **The whole deck protocol row block is unimplemented on the OD Next side.**
  `assets/task-profiles/ppt.md` asks for a "single-file HTML deck / openable and
  pageable" but pins none of the markers — `data-od-deck-protocol`, the ready
  announce, the state posts, the navigate listener, `id="deck-stage"`,
  `@media print` are all absent from that plugin folder. A deck generated on the
  OD Next path can therefore fail to be recognized as a v1 deck, paged from the
  host toolbar, or exported to PDF.
  The fix should give both sides one source — an OD Next atom referencing
  `DECK_PROTOCOL_V1_INLINE_RUNTIME` / `DECK_SKELETON_HTML`, or a declared
  `resources` entry on the `ppt` profile the way `prototype` already ships its
  device shells — rather than copying the skeleton into markdown as a third copy.
- **No machine check covers the OD Next column.** The legacy axis does have one:
  `packages/contracts/tests/system-prompt.test.ts:153` and
  `apps/daemon/tests/prompts/system.test.ts:360` each assert the composed prompt
  contains `data-od-deck-protocol="1"`, which is what keeps the two legacy copies
  honest. Neither passes an OD Next recipe, so neither can fail on this gap.
  Extending one of them with a recipe-bearing case is the cheapest available red
  spec.
