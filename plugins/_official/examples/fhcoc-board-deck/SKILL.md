---
name: fhcoc-board-deck
en_name: Chamber Board Deck
description: |
  A chamber board meeting deck in 16:9 HTML slides: cover, agenda,
  membership health, a new-member chart, an events scorecard, budget
  versus actual, a member quote, and the decisions the board is asked to
  make. Use when the brief asks for a "board deck", "board meeting",
  "quarterly review", "board pre-read", or "committee deck".
en_description: |
  An eight-slide chamber board deck covering membership health, events,
  financials, and the decisions on the table.
triggers:
  - "board deck"
  - "board meeting"
  - "board pre-read"
  - "quarterly review"
  - "committee deck"
  - "chamber deck"
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
  example_prompt: "Build the Q1 board deck: membership health, new members by month, the events scorecard, budget versus actual, and the three decisions we need at the meeting."
---

# Chamber Board Deck Skill

A board meets for ninety minutes and decides three things. Build the deck
backwards from those decisions.

## Workflow

1. **Read the active DESIGN.md** (injected above). Navy `--meta` grounds
   the cover, the quote slide, and the chart bars; orange `--accent`
   marks the leading bar and the single call-to-action block. Poppins
   throughout.
2. **Pull the facts** and invent specific values where the brief is
   silent: quarter, meeting date and room, presenter, member counts,
   renewal rate, dues run rate, event attendance and net revenue, budget
   lines, and the asks.
3. **Build eight slides**, each `aspect-ratio: 16 / 9`, stacked
   vertically on the warm ground with a 16px radius, `overflow: hidden`,
   and a footer strip carrying the chamber wordmark and a slide number:
   1. Cover, navy full-bleed: chamber mark, deck title, date and room,
      presenter line.
   2. Agenda, a numbered list in two columns.
   3. Membership health, a four-up big-stat row plus one takeaway line.
   4. A pure-CSS bar chart of new members by month, with a two-sentence
      read-out.
   5. Events scorecard, a table of event, date, attendance, net revenue.
   6. Financials, a budget-versus-actual mini table beside a warm callout
      card carrying the surplus.
   7. A member quote on navy, large white type, attribution line.
   8. Closing, "decisions we need today", three numbered asks, and one
      orange motion block.
4. **Vary the layouts.** Eight slides that share a layout read as filler.
   Scale type with `clamp()` so nothing overflows its frame.
5. **Charts and tables are plain CSS.** No libraries, no canvas.
6. **Write** one self-contained HTML document, all CSS inline, no external
   scripts, no remote images.
7. **Tag** each slide with `data-od-id="slide-cover"`, `"slide-agenda"`,
   and so on.

## Self-check

- Every number on a stat slide has a label a trustee can repeat.
- The asks on the closing slide are phrased as motions, not topics.
- Nothing overflows a 16:9 frame at 1120px wide.
- No placeholder text. No em dashes, no arrow glyphs, no "AI".

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="fhcoc-board-deck" type="text/html" title="Board Deck Title">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact, nothing after.
