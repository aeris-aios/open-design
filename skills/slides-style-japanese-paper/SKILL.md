---
name: slides-style-japanese-paper
zh_name: "日式和纸编辑幻灯片"
en_name: "Japanese Paper Editorial Slides"
description: "Create or restyle slide decks in the Japanese Paper Editorial visual system: washi paper, sumi ink, vermilion blocks, indigo rules, Mincho-inspired serif type, and vertical text rails. Use for culture, craft, design research, exhibitions, and thoughtful strategy; avoid dense dashboards or loud sales decks. Works across HTML, PPTX, Keynote, Google Slides, and other editable slide formats."
triggers:
  - "Japanese Paper Editorial Slides"
  - "日式和纸编辑幻灯片"
  - "slides-style-japanese-paper"
  - "Japanese Paper Editorial slide style"
  - "apply this slide style"
  - "用这个风格做幻灯片"
tags: ["slides", "presentation", "design-system", "japanese-paper"]
od:
  mode: design-system
  category: slides
  surface: web
  preview:
    type: html
    entry: assets/template.html
---

# Japanese Paper Editorial Slides

Apply this visual system to a complete presentation without depending on an OpenDesign plugin.

## Use this skill when

- The user names this style, points to its reference, or asks for the visual qualities in the description.
- The content fits: culture, craft, design research, exhibitions, and thoughtful strategy.
- Do not select it for dense dashboards or loud sales decks, unless the user explicitly asks for the contrast.

## Workflow

1. Confirm or infer the audience, decision or communication goal, source material, language, output format, and approximate slide count. Ask only when a missing choice would materially change the result.
2. Read [references/style-system.md](references/style-system.md) before composing. Treat its palette, typography, spacing, signature devices, and forbidden moves as constraints.
3. Build a one-sentence narrative for the deck, then assign one job and one primary claim to every slide. Choose the closest supplied layout before inventing a new one.
4. For HTML, copy [assets/template.html](assets/template.html) and preserve its stage, navigation, style tokens, and layout classes. `node --experimental-strip-types scripts/new-deck.ts <output.html>` is an optional safe copier.
5. For PPTX, Keynote, Google Slides, Figma Slides, or another native format, recreate the same token values and composition grammar with editable native elements. The HTML is a visual source of truth, not a required runtime.
6. Replace the sample content; do not reuse its claims as facts. Rewrite content before shrinking type, breaking the grid, or introducing a one-off component.
7. Run `node --experimental-strip-types scripts/validate-deck.ts <output.html>` for HTML, then render and inspect every slide at 16:9. Fix clipping, weak contrast, accidental overlap, inconsistent page numbering, and off-style additions.

## Non-negotiables

- Preserve the visual signature: washi paper, sumi ink, vermilion blocks, indigo rules, Mincho-inspired serif type, and vertical text rails.
- Keep every slide focused on one idea. Use evidence, diagrams, or spatial composition instead of defaulting to repeated cards.
- Use only user-provided or sourced facts. Never invent metrics, quotes, people, dates, or citations.
- Keep text editable and semantic. Use CSS or native vector shapes for decoration when possible.
- Do not import colors, fonts, shadows, gradients, radii, or components from another style skill.
- Return the requested artifact plus a short list of source assumptions and any unresolved factual placeholders.

The reusable visual specification is [references/style-system.md](references/style-system.md); the reference implementation is [assets/template.html](assets/template.html).
