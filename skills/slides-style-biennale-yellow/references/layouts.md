# Biennale Yellow Slides layout registry

Read this reference when outlining a deck or when content no longer fits the current page. Use the closest registered layout before creating a new one. A new layout is acceptable only when it recombines the same grid, type roles, color budget, and signature devices.

Registered layout IDs: `cover`, `manifesto`, `programme`, `chapter`, `data`, `quote`, `calendar`, `closing`

## Density modes

- `speaker`: one idea per slide, up to three short bullets or four compact items, strong pacing, and generous negative space. Split content before reducing body text below 22 px on a 1600 × 900 canvas.
- `reader`: self-contained evidence for async reading, up to eight concise bullets or six comparable items. Split content before reducing body text below 18 px.
- The template default is `speaker`. Change it only when the delivery context requires the other mode; declare the choice with `data-density` in HTML or in the deck's authoring notes for native formats.

## Registered layouts

| ID | Role | Use when | Guardrail |
|---|---|---|---|
| `cover` | Cover | Open with one memorable thesis and minimal supporting copy. | Keep the title dominant; no agenda, dashboard, or multi-card payload. |
| `manifesto` | Manifesto | Deliver a single high-conviction statement or editorial passage. | Protect whitespace; split the slide before shrinking the statement. |
| `programme` | Programme | Present a structured sequence of modules or moves. | Keep item labels parallel and durations explicit when known. |
| `chapter` | Chapter | Open a chapter with a framing claim. | Prefer a single claim over explanatory detail. |
| `data` | Data | Make one quantitative finding the visual hero. | State the takeaway; do not show decorative or invented data. |
| `quote` | Quote | Give one attributed voice or qualitative proof point room to breathe. | Keep attribution visible and never fabricate the quote. |
| `calendar` | Calendar | Map work or events to time. | Use real dates and keep the reading order unambiguous. |
| `closing` | Closing | End with the decision, takeaway, or next action. | Do not introduce new evidence or a second competing message. |

## Selection rules

1. Start from the claim and evidence shape, not from visual novelty.
2. Reuse a layout when the information hierarchy matches, even if the subject matter differs.
3. Split content when a layout exceeds its density limit; do not create smaller text as a workaround.
4. Preserve the style's alignment axes, spacing rhythm, and signature devices across every registered layout.
5. In HTML, set `data-layout="<id>"` on every slide. In PPTX, Keynote, Google Slides, or Figma Slides, record the same ID in speaker notes, layer names, or authoring metadata when practical.
