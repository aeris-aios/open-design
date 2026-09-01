---
name: fhcoc-state-of-the-town-deck
en_name: State of the Town Deck
description: |
  The chamber's annual community address in 16:9 HTML slides: cover, the
  year in one page, the business climate, where visitors come from, the
  three community pillars, the year ahead, partners, and a membership
  close. Use when the brief asks for a "state of the town", "community
  address", "annual meeting deck", or "economic update".
en_description: |
  An eight-slide community address deck covering the business climate,
  visitors, community pillars, the year ahead, and partners.
triggers:
  - "state of the town"
  - "community address"
  - "annual meeting deck"
  - "economic update"
  - "town address"
od:
  featured: 0.02
  mode: deck
  platform: desktop
  scenario: strategy
  preview:
    type: html
    entry: example.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Build the State of the Town deck: the year in one page, business climate, where visitors come from, our three community pillars, and what is ahead in 2027."
---

# State of the Town Deck Skill

This deck is presented to a room of members, town staff, and residents. It
is a civic document, so it stays plain, specific, and generous with credit.

## Workflow

1. **Read the active DESIGN.md** (injected above). Navy `--meta` grounds
   the cover and the close; orange `--accent` marks the leading bar and
   the single call-to-action block. Poppins throughout.
2. **Pull the facts** and invent specific values where the brief is
   silent: year, venue and date, occupancy, new business licences,
   average tenure, visitor spend, visitor origin split, milestones, and
   partner names.
3. **Build eight slides**, each `aspect-ratio: 16 / 9`, stacked on the
   warm ground with a footer strip carrying the chamber wordmark and a
   slide number:
   1. Cover, navy full-bleed with a subtle CSS fountain motif, the title,
      the organization, the date and venue.
   2. The year in one page, a three-up stat block.
   3. Business climate, four labelled data rows beside a short narrative.
   4. A pure-CSS horizontal bar chart of visitor origin.
   5. Three community pillars as a three-card row.
   6. A horizontal timeline of four milestones with month labels.
   7. Partners, a grid of bordered nameplates.
   8. Close, navy ground, the brand line, the contact line, one orange
      membership block.
4. **Vary the layouts** and scale type with `clamp()` so nothing overflows
   its frame.
5. **Charts and timelines are plain CSS.** No libraries, no canvas.
6. **Write** one self-contained HTML document, all CSS inline, no external
   scripts, no remote images.
7. **Tag** each slide with `data-od-id="slide-cover"` and friends.

## Self-check

- Every claim on the climate slide is a number with a unit and a period.
- Partners are named, spelled consistently, and given equal weight.
- Nothing overflows a 16:9 frame at 1120px wide.
- No placeholder text. No em dashes, no arrow glyphs, no "AI".

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="fhcoc-state-of-the-town-deck" type="text/html" title="Address Title">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact, nothing after.
