# Sidecar lifecycle protocol

The control plane has two authorities and no persisted state machine.

## Service authority: `LeaseDirectory`

For each `channel + namespace + generation + service`, one active lease
directory exists or it does not. Creating that directory is the start
linearization point. Its contents are monotonic:

- `metadata.json` is written once and identifies the incarnation, owner and
  terminal mode (`process` or `hosted`).
- `process.json` is written once when the controller captures its child;
  `body.json` is written once by the exact body that consumes the claim.
- `ready` and `stopping` are append-only markers.

The visible phase is derived from those files. No authoritative file is
replaced, and a missing or malformed member inside an existing lease is an
error, never absence. Retirement first renames the exact active incarnation
out of the active path; cleanup only removes that retired path. An old
incarnation therefore cannot delete its successor.

JSON members are fully flushed to unique pending files and atomically linked
into their final names. A crash before publication leaves an authoritative but
recognizable unpublished directory that the next lifecycle session retires;
it never exposes a partial final file or an empty slot.

`attachSidecar` consumes an exact claim created by the controller. A body does
not create, repair or adopt its own authority.

## Mutation authority: `LifecycleSession`

Lifecycle mutation is serialized by one OS endpoint for
`runtimeRoot + channel + namespace`; generation and service are deliberately
excluded. The endpoint is held for the complete mutation callback, including
product-owned deletion, installation or restart work.

Possession of the callback is the convergence proof. There is no transferable
proof object: once the callback returns, another generation may start.
Nested sidecar calls in the same callback are re-entrant; other processes wait.

## Terminal stop

The public API exposes only `stop()`:

- a spawned lease is terminal after the controller-captured child exits and the exact
  lease is retired;
- a caller-hosted lease is terminal after its shutdown callback completes,
  its attached endpoint closes and the exact lease is retired.

The private wire request is only a step in that operation. Acceptance is not a
public lifecycle result, PID liveness is not a hosted terminal condition, and
force/escalation is an implementation detail of an owning launch handle.
