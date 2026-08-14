# OD Next HyperFrames Task Profile v2.0.0

> Rollout: active

## Profile fields

Resolve platform and purpose, duration, frame shape and rate, script or
storyboard locks, scenes, supplied media, on-screen copy, voice, music,
captions, and required source and rendered outputs. Freeze palette, type,
composition, scene language, motion timing, transitions, safe areas, and audio
rules in the Design Spec.

## Artifact contract

The canonical deliverable is editable HyperFrames source with a stable render
entry. When the task requires a finished film, the required deliverables also
include the rendered media file. A Build Package that owns rendering declares
the exact format, duration, frame dimensions, and frame rate.

## Build Requirements

- Give each scene one narrative purpose and organize scenes into a readable
  temporal arc.
- Keep characters, products, environments, light, palette, type, and graphic
  language continuous across scenes unless the story explicitly changes them.
- Use movement to communicate entrance, exit, emphasis, transition, cause, or
  spatial relation; avoid arbitrary shake, spin, and zoom.
- Give titles and sentences enough screen time for the declared audience and
  protect them from platform overlays.
- Keep voice, captions, music, sound effects, and visual transitions aligned
  to the frozen timing plan.
- Preserve locked scene order, copy, duration, transitions, and supplied media.
- Produce the declared source bundle and render outputs through the stated
  production route; do not substitute a static sequence for requested motion.
- Centralize motion, type, color, and scene tokens so dependent segments use
  the same system.

## Build Packages

Simple mode builds the full timeline in one context. Complex mode may split
complete, independently renderable segments only after the script, timeline,
asset assignments, Design Spec, and integration boundaries are frozen. A
single shot stays within one package. Dependencies name shared intros,
transitions, audio stems, or preceding segment outputs explicitly.
