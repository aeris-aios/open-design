# Block Frame Slides layout registry

Read this reference when outlining a deck or when content no longer fits the current page. Use the closest registered layout before creating a new one. A new layout is acceptable only when it recombines the same grid, type roles, color budget, and signature devices.

Registered layout IDs: `cover`, `problem-brief`, `principle`, `evidence`, `statement`, `system-grammar`, `timeline`, `outcome`, `deliverables`, `checklist`

## Density modes

- `speaker`: one idea per slide, up to three short bullets or four compact items, strong pacing, and generous negative space. Split content before reducing body text below 22 px on a 1600 × 900 canvas.
- `reader`: self-contained evidence for async reading, up to eight concise bullets or six comparable items. Split content before reducing body text below 18 px.
- The template default is `reader`. Change it only when the delivery context requires the other mode; declare the choice with `data-density` in HTML or in the deck's authoring notes for native formats.

## Registered layouts

| ID | Role | Use when | Guardrail |
|---|---|---|---|
| `cover` | Cover | Open with one memorable thesis and minimal supporting copy. | Keep the title dominant; no agenda, dashboard, or multi-card payload. |
| `problem-brief` | Problem Brief | Use this layout only for content that matches its demonstrated information shape. | Preserve its hierarchy, alignment, and signature spacing before adding variants. |
| `principle` | Principle | Use this layout only for content that matches its demonstrated information shape. | Preserve its hierarchy, alignment, and signature spacing before adding variants. |
| `evidence` | Evidence | Show a real trend, comparison, or composition. | Label the conclusion and preserve readable axes and units. |
| `statement` | Statement | Make one quantitative finding the visual hero. | State the takeaway; do not show decorative or invented data. |
| `system-grammar` | System Grammar | Use this layout only for content that matches its demonstrated information shape. | Preserve its hierarchy, alignment, and signature spacing before adding variants. |
| `timeline` | Timeline | Explain a dated or sequential progression. | Keep stages parallel and prevent labels from entering the navigation safe zone. |
| `outcome` | Outcome | Show a real trend, comparison, or composition. | Label the conclusion and preserve readable axes and units. |
| `deliverables` | Deliverables | Use this layout only for content that matches its demonstrated information shape. | Preserve its hierarchy, alignment, and signature spacing before adding variants. |
| `checklist` | Checklist | End with the decision, takeaway, or next action. | Do not introduce new evidence or a second competing message. |

## Selection rules

1. Start from the claim and evidence shape, not from visual novelty.
2. Reuse a layout when the information hierarchy matches, even if the subject matter differs.
3. Split content when a layout exceeds its density limit; do not create smaller text as a workaround.
4. Preserve the style's alignment axes, spacing rhythm, and signature devices across every registered layout.
5. In HTML, set `data-layout="<id>"` on every slide. In PPTX, Keynote, Google Slides, or Figma Slides, record the same ID in speaker notes, layer names, or authoring metadata when practical.
