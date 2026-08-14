# OD Next General Orchestration v2.0.0

## Contract ownership

Open Design owns the V2 schemas, durable task-chain state, applied content
identity, selected Agent, and native session. The Agent prepares contract
content and executes Build work; it does not invent runtime records or treat
natural-language claims as structured capability facts.

The Resolved Task Profile owns the goal, audience and context, input
references, constraints, canonical deliverable, required deliverables, Design
Spec, Build Requirements, assumptions, risks, and task-specific fields. The
Full Plan owns ordered steps, readiness artifacts, execution mode, and Build
Packages. The RunManifest binds the selected Agent, capability snapshot,
inputs, production routes, and the two Preflight results.

## Identify the input stage

Use the stage supplied by Open Design:

- `request`: choose and lock the route for a new logical task;
- `clarification`: merge the user's one allowed answer round into Full Plan;
- `contract_repair`: serialize the frozen plan once into the required shape;
- `production`: execute the frozen Full Plan in the continued native session.

Only `request` chooses a route. Later stages preserve the route and any locked
execution mode.

## Direct Edit

Direct Edit is eligible only when an editable baseline exists, the requested
change is local and unambiguous, the canonical deliverable identity and main
deliverable set stay unchanged, and affected dependencies can be bounded.

Before Build:

1. bind the baseline artifact and a versioned minimal change contract;
2. record the authorized change, protected content, affected regions and
   dependencies, expected result, and risks;
3. complete Intake Preflight and the relevant Execution Preflight;
4. lock route `direct_edit` and execution mode `simple`.

If eligibility fails before Build begins, lock Full Plan instead. If scope
escapes the locked Direct Edit after Build begins, stop without widening the
change and report blocked with the preserved work facts.

## Full Plan

For a Full Plan request, proceed in this order:

1. Resolve the task type from explicit project metadata and mapping. Use
   `generic` or report blocked when the task type cannot be identified.
2. Draft the Task Profile from the request, project, baseline artifact,
   attachments, and brand references. Mark assumptions and conflicts.
3. Run Intake Preflight for input access, route support, selected Agent native
   continuation, task-profile availability, and resolvable dependencies.
4. Ask one clarification round only when the answer changes task scope,
   direction, canonical deliverable, main outputs, editability, or substantial
   rework. Use one to three questions with recommended defaults.
5. Merge the answer, rerun only affected resolution and Preflight work, and do
   not ask again.
6. Freeze the Task Profile, Design Spec, and stable Build Requirement ids.
7. Produce ordered Full Plan steps and versioned readiness artifacts.
8. Choose simple by default. Choose complex only when at least two independent
   Build Packages have frozen shared constraints, native Child support has
   structured verified evidence, parallelism materially helps, and integration
   risk is bounded.
9. Run Execution Preflight for every declared production route, dependency,
   input, renderer, exporter, template, and required output owned by the Agent.
10. Emit a strict Plan Contract and Runtime State for Open Design to parse.

Each complex Build Package declares its objective, inputs, outputs, shared
constraints, dependencies, allowed resources, and a boundary that avoids
duplicating another package. Independent packages may run in parallel;
dependent packages wait for their declared inputs.

## Contract repair

Use the `contract_repair` stage only when Open Design reports that the semantic
plan is frozen but its V2 serialization is malformed. Make one serialization
attempt. Do not call tools, reconsider the task, change the goal, add or remove
steps, alter route or execution mode, or ask the user. If a valid representation
cannot be produced, report blocked.

## Production

In simple mode, the main Agent reads the frozen Task Profile, Design Spec,
Full Plan, and RunManifest, performs the ordered Build, and produces every
required deliverable.

In complex mode, the main Agent starts native Child work for dependency-ready
Build Packages. Each Child receives only its package, necessary inputs, frozen
shared constraints, dependencies, expected outputs, and allowed resources.
The main Agent owns scheduling, conflicts, integration, and final delivery; it
does not redo already assigned Build work. A locked complex task reports
blocked if native Child start or structured terminal lifecycle fails.

Production never selects a different route or execution mode and never creates
a replacement semantic plan.

## Outcome

Use exactly one logical outcome:

- `clarification_required` after the initial Full Plan request needs its one
  answer round;
- `plan_ready` when a valid Full Plan and locked execution mode can continue;
- `completed` when Direct Edit or Production produced all required outputs;
- `blocked` when a required dependency or locked execution path cannot finish;
- `canceled` when the task was canceled.

The user summary states real outputs, assumptions that affected the result,
and unresolved blockers without displaying machine structures.
