---
name: fhcoc-sponsorship-packet
en_name: Sponsorship Packet
description: |
  A chamber sponsorship prospectus on letter sheets: the audience
  numbers, where a sponsor's name appears, a four-tier benefit comparison
  table, an add-on rate card, and one reserve-a-tier call to action. Use
  when the brief asks for a "sponsorship packet", "partnership
  prospectus", "sponsor deck", "rate card", or "sponsorship levels".
en_description: |
  A two-sheet chamber sponsorship prospectus with audience stats, a tier
  comparison table, an add-on rate card, and a contact block.
triggers:
  - "sponsorship packet"
  - "partnership prospectus"
  - "sponsorship levels"
  - "sponsor packet"
  - "rate card"
  - "sponsorship tiers"
od:
  featured: 0.02
  mode: prototype
  platform: desktop
  scenario: sales
  preview:
    type: html
    entry: example.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Build the 2027 sponsorship prospectus, with audience numbers, the four tier levels and what each includes, the add-on rate card, and a reserve a tier call to action."
---

# Chamber Sponsorship Packet Skill

This document is sent to a business owner who has ninety seconds. It has to
prove reach, price the options, and make the next step obvious.

## Workflow

1. **Read the active DESIGN.md** (injected above). Navy `--meta` carries
   structure and the table head, orange `--accent` appears twice at most:
   the accent rule and the reserve block. Poppins throughout.
2. **Pull the facts** and invent specific values where the brief is
   silent: season year, member count, newsletter reach, event attendance,
   renewal rate, tier names and prices, add-on prices, contact name.
3. **Lay out** as a stack of letter-proportioned sheets
   (`aspect-ratio: 8.5 / 11`), each white on the warm ground with a page
   number in its footer:
   - **Sheet 1** — navy masthead with the chamber mark and the prospectus
     title; an oversized navy headline; a short orange accent rule; a
     three-sentence pitch; a four-up audience stat block; and a "where
     your name appears" list of labelled rows.
   - **Sheet 2** — the tier comparison table: tiers as columns, benefits
     as rows, marks in the cells, and one column highlighted on the warm
     ground. Then an add-on rate card as labelled line items with prices.
     Then a contact block with one orange call-to-action block and the
     chamber contact line.
4. **The table is the centerpiece.** Head row in navy with white labels,
   hairline row separators, prices set in the display weight, benefit
   labels left-aligned and marks centered. Never let it overflow the sheet.
5. **Write** one self-contained HTML document, all CSS inline, no external
   scripts, no remote images. Check marks are inline SVG or a styled
   character, never an emoji.
6. **Tag** regions with `data-od-id="masthead"`, `"audience"`,
   `"placement"`, `"tiers"`, `"ratecard"`, `"contact"`.
7. **Print safety**: an `@media print` block that removes shadows and
   keeps each sheet on one page. Body text never smaller than 12px.

## Self-check

- Every tier has a price and at least four concrete benefits.
- The rate card items are priced, with the unit stated (per month, per
  issue, per quarter).
- No placeholder text. No em dashes, no arrow glyphs, no "AI".
- Content fits inside each fixed-aspect sheet, nothing clipped.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="fhcoc-sponsorship-packet" type="text/html" title="Prospectus Title">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact, nothing after.
