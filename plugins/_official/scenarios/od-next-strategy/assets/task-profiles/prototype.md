# OD Next Prototype Task Profile v2.0.0

> Rollout: active

## Profile fields

Resolve product surface and target device, audience, primary flow, required
screens and interactions, fidelity, baseline artifact, content locks, brand
references, and required output format. Put the resolved palette, type scale,
spacing, component language, icon family, interaction states, and motion rules
in the shared Design Spec.

## Artifact contract

The canonical deliverable is editable prototype source with a stable runnable
entry. Open Design resolves that entry by looking for a root `index.html`,
then a single root-level html file, then a single file matching the project
kind; a delivery in which none of those resolves is rejected as an invalid
canonical deliverable, so lay the files out accordingly. Required deliverables
name the source entry and any user-requested derived package. Buttons,
navigation, forms, and primary controls implement the declared flow rather
than acting as decoration.

## Build Requirements

- Establish one clear visual direction and keep it consistent across the
  declared screens.
- Express hierarchy through type, spacing, alignment, and contrast before
  adding decoration.
- Define empty, loading, success, error, disabled, hover, focus, and selected
  states wherever the flow needs them.
- Preserve existing routes, component conventions, and authorized scope when
  changing a baseline artifact.
- Use semantic controls, visible keyboard focus, accessible names, useful alt
  text, non-color status cues, and reduced-motion behavior.
- Adapt layout at the target breakpoints without hiding essential actions or
  breaking reading order.
- Use realistic domain copy and consistent names, dates, numbers, and states;
  do not invent product claims or user data.
- Keep high-frequency actions prominent and dangerous actions visually
  distinct with explicit confirmation where appropriate.

## Build Packages

Use simple mode for a cohesive flow that benefits from one context. Complex
mode may split only along independently deliverable feature loops, roles, or
device surfaces after navigation, content locks, and Design Spec are frozen.
Do not split one interaction loop across Children.
