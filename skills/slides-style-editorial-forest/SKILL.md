---
name: slides-style-editorial-forest
zh_name: "林间编辑幻灯片"
en_name: "Editorial Forest Slides"
description: "Create or restyle slide decks in the Editorial Forest visual system: forest green, dusty pink, warm cream paper, serif-led magazine rhythm, and mosaic editorial layouts. Use for annual reports, design reviews, research recaps, and brand storytelling; avoid urgent sales pitches or high-adrenaline product launches. Works across HTML, PPTX, Keynote, Google Slides, and other editable slide formats."
triggers:
  - "Editorial Forest Slides"
  - "林间编辑幻灯片"
  - "slides-style-editorial-forest"
  - "Editorial Forest slide style"
  - "apply this slide style"
  - "用这个风格做幻灯片"
tags: ["slides", "presentation", "design-system", "editorial-forest"]
od:
  mode: design-system
  category: slides
  surface: web
  preview:
    type: html
    entry: assets/template.html
---

# Editorial Forest Slides

Apply this visual system to a complete presentation without depending on an OpenDesign plugin.

## Use this skill when

- The user names this style, points to its reference, or asks for the visual qualities in the description.
- The content fits: annual reports, design reviews, research recaps, and brand storytelling.
- Do not select it for urgent sales pitches or high-adrenaline product launches, unless the user explicitly asks for the contrast.

## Workflow

1. Confirm or infer the audience, decision or communication goal, source material, language, output format, and approximate slide count. Ask only when a missing choice would materially change the result.
2. Read [references/style-system.md](references/style-system.md) before composing. Treat its palette, typography, spacing, signature devices, and forbidden moves as constraints.
3. Build a one-sentence narrative for the deck, then assign one job and one primary claim to every slide. Choose the closest supplied layout before inventing a new one.
4. For HTML, copy [assets/template.html](assets/template.html) and preserve its stage, navigation, style tokens, and layout classes. `node --experimental-strip-types scripts/new-deck.ts <output.html>` is an optional safe copier.
5. For PPTX, Keynote, Google Slides, Figma Slides, or another native format, recreate the same token values and composition grammar with editable native elements. The HTML is a visual source of truth, not a required runtime.
6. Replace the sample content; do not reuse its claims as facts. Rewrite content before shrinking type, breaking the grid, or introducing a one-off component.
7. Run `node --experimental-strip-types scripts/validate-deck.ts <output.html>` for HTML, then render and inspect every slide at 16:9. Fix clipping, weak contrast, accidental overlap, inconsistent page numbering, and off-style additions.

## Non-negotiables

- Preserve the visual signature: forest green, dusty pink, warm cream paper, serif-led magazine rhythm, and mosaic editorial layouts.
- Keep every slide focused on one idea. Use evidence, diagrams, or spatial composition instead of defaulting to repeated cards.
- Use only user-provided or sourced facts. Never invent metrics, quotes, people, dates, or citations.
- Keep text editable and semantic. Use CSS or native vector shapes for decoration when possible.
- Do not import colors, fonts, shadows, gradients, radii, or components from another style skill.
- Return the requested artifact plus a short list of source assumptions and any unresolved factual placeholders.

The reusable visual specification is [references/style-system.md](references/style-system.md); the reference implementation is [assets/template.html](assets/template.html).
