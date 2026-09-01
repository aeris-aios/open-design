---
name: fhcoc-event-poster
en_name: Chamber Event Poster
description: |
  A bold portrait event poster for a chamber event: navy ground, a large
  fountain motif, an enormous display title, the date, time, and venue
  block, one orange call to action, and a presenting-partner strip. Sized
  for a window, a lobby easel, and a square-cropped social repost. Use
  when the brief asks for an "event poster", "window poster", "key art",
  or "promo graphic".
en_description: |
  A portrait chamber event poster: navy ground, fountain motif, enormous
  title, date and venue block, one call to action, partner strip.
triggers:
  - "event poster"
  - "poster"
  - "window poster"
  - "key art"
  - "promo graphic"
  - "lobby poster"
od:
  featured: 0.02
  mode: image
  platform: desktop
  scenario: design
  preview:
    type: html
    entry: example.html
  design_system:
    requires: true
    sections: [color, typography, layout]
  example_prompt: "Design a portrait poster for the State of the Town breakfast, with the date, time, venue, member and guest pricing, and the presenting partners."
---

# Chamber Event Poster Skill

One poster, one focal point, readable from across a lobby. Everything else
is subordinate to the title and the date.

## Workflow

1. **Read the active DESIGN.md** (injected above). This poster is a dark
   composition: navy ground (`--meta` deepened toward `#032f54`), white
   type, orange `--accent` used once as the accent bar and once on the
   call to action. Poppins throughout.
2. **Pull the facts** and refuse to leave any as a placeholder: event
   name, date, start and end time, venue name, street address, price by
   audience, the registration destination, and the presenting partners.
   If the brief omits one, generate a specific, plausible value.
3. **Compose** a portrait sheet (`aspect-ratio: 2 / 3`), top to bottom:
   - Chamber mark in white at the top.
   - A short uppercase eyebrow naming the series and the audience.
   - The title in white at display weight, two or three lines,
     `line-height: 1.02`, negative tracking. This is the only thing
     readable from across a room.
   - One orange accent bar under the title.
   - Date, time, and venue as three labelled rows or a strip.
   - A two-line pitch.
   - One solid orange call-to-action block with the URL beneath it.
   - A bottom strip of outlined partner nameplates.
   - A background motif built from CSS or inline SVG at low opacity:
     concentric arcs, a stylized fountain plume, or a soft radial wash.
     It must never compete with the type.
4. **Write** one self-contained HTML document, all CSS inline, no external
   scripts, no remote images.
5. **Tag** regions with `data-od-id="mark"`, `"title"`, `"details"`,
   `"cta"`, `"partners"`.
6. **Print safety**: an `@media print` block that removes shadows and
   keeps the poster on one sheet. Body text never smaller than 12px.

## Self-check

- Orange appears at most twice.
- The title survives being viewed at 25% zoom.
- Contrast of white on the navy ground stays above 4.5:1.
- No placeholder text. No em dashes, no arrow glyphs, no "AI".

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="fhcoc-event-poster" type="text/html" title="Poster Title">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact, nothing after.
