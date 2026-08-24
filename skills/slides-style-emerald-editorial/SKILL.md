---
name: slides-style-emerald-editorial
zh_name: "祖母绿编辑幻灯片"
en_name: "Emerald Editorial Slides"
description: "Create or restyle slide decks in the Emerald Editorial visual system: emerald fields, navy ink, high-contrast Bodoni display type, and fashion-magazine masthead details. Use for brand launches, campaign narratives, premium reports, and editorial strategy; avoid dense technical documentation or utilitarian training. Works across HTML, PPTX, Keynote, Google Slides, and other editable slide formats."
triggers:
  - "Emerald Editorial Slides"
  - "祖母绿编辑幻灯片"
  - "slides-style-emerald-editorial"
  - "Emerald Editorial slide style"
  - "apply this slide style"
  - "用这个风格做幻灯片"
tags: ["slides", "presentation", "design-system", "emerald-editorial"]
od:
  mode: design-system
  category: slides
  surface: web
  preview:
    type: html
    entry: assets/template.html
---

# Emerald Editorial Slides

Apply this visual system to a complete presentation without depending on an OpenDesign plugin.

## Use this skill when

- The user names this style, points to its reference, or asks for the visual qualities in the description.
- The content fits: brand launches, campaign narratives, premium reports, and editorial strategy.
- Do not select it for dense technical documentation or utilitarian training, unless the user explicitly asks for the contrast.

## Workflow

1. Confirm or infer the audience, decision or communication goal, source material, language, output format, and approximate slide count. Ask only when a missing choice would materially change the result.
2. Read [references/style-system.md](references/style-system.md) before composing. When choosing or adapting pages, also read [references/layouts.md](references/layouts.md); load [references/quality-gate.md](references/quality-gate.md) before validation.
3. Choose `speaker` or `reader` density, build a one-sentence narrative, then assign one job and one primary claim to every slide. Select a registered layout that matches the information shape before inventing a new one.
4. For HTML, copy [assets/template.html](assets/template.html) and preserve its stage, navigation, style tokens, and layout classes. `node --experimental-strip-types scripts/new-deck.ts <output.html>` is an optional safe copier.
5. For PPTX, Keynote, Google Slides, Figma Slides, or another native format, recreate the same token values and composition grammar with editable native elements. The HTML is a visual source of truth, not a required runtime.
6. Replace the sample content; do not reuse its claims as facts. Bind each content image to a named `data-image-slot` in HTML or an equivalent named placeholder in native slide formats. Rewrite or split content before shrinking type, breaking the grid, or introducing a one-off component.
7. Read [references/quality-gate.md](references/quality-gate.md), run `node --experimental-strip-types scripts/validate-deck.ts <output.html>` for HTML, then render and inspect every slide at 16:9 plus one narrow viewport. Fix clipping, collisions, unreadable type, navigation intrusion, broken image slots, and off-style additions.

## Non-negotiables

- Preserve the visual signature: emerald fields, navy ink, high-contrast Bodoni display type, and fashion-magazine masthead details.
- Keep every slide focused on one idea. Use evidence, diagrams, or spatial composition instead of defaulting to repeated cards.
- Use only user-provided or sourced facts. Never invent metrics, quotes, people, dates, or citations.
- Keep text editable and semantic. Use CSS or native vector shapes for decoration when possible.
- Do not import colors, fonts, shadows, gradients, radii, or components from another style skill.
- Return the requested artifact plus a short list of source assumptions and any unresolved factual placeholders.

The reusable visual specification is [references/style-system.md](references/style-system.md); the reference implementation is [assets/template.html](assets/template.html).
