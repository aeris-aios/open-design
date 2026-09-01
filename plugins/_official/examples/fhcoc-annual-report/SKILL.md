---
name: fhcoc-annual-report
en_name: Chamber Annual Report
description: |
  The chamber annual report on letter sheets: a cover, the chair and
  president letter, a year-in-numbers stat grid, a CSS revenue-by-source
  bar chart, a program spotlight, and the board roster. Use when the brief
  asks for an "annual report", "year in review", "stewardship report", or
  "impact report".
en_description: |
  A two-sheet chamber annual report with a cover, leadership letter, stat
  grid, revenue chart, program spotlight, and board roster.
triggers:
  - "annual report"
  - "year in review"
  - "impact report"
  - "stewardship report"
  - "yearly report"
od:
  featured: 0.02
  mode: prototype
  platform: desktop
  scenario: operations
  preview:
    type: html
    entry: example.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Lay out the 2026 annual report, with the chair letter, the year in numbers, revenue by source, a program spotlight, and the board of directors."
---

# Chamber Annual Report Skill

Members and funders read this to answer one question: what did the chamber
do with the year. Numbers first, prose second.

## Workflow

1. **Read the active DESIGN.md** (injected above). Navy `--meta` grounds
   the cover and the chart bars, orange `--accent` marks the single
   largest bar and the accent rule. Poppins throughout.
2. **Pull the facts** and invent specific values where the brief is
   silent: year, member count, new members, events held, attendance,
   ribbon cuttings, volunteer hours, revenue split, board names.
3. **Lay out** as a stack of letter-proportioned sheets
   (`aspect-ratio: 8.5 / 11`), white on the warm ground, page numbered:
   - **Sheet 1** — a navy full-bleed cover band across the top with the
     chamber mark, the year, and the report title; then a leadership
     letter of three short paragraphs with two signatures and titles; then
     a three-up highlight row.
   - **Sheet 2** — "the year in numbers" as a six-up stat grid; a
     revenue-by-source horizontal bar chart; a two-column program
     spotlight; and the board roster in a three-column list.
4. **Charts are pure CSS.** Bars are divs with percentage widths, navy
   with the largest bar in orange, each labelled with both the source and
   the percentage. No chart library, no canvas.
5. **Write** one self-contained HTML document, all CSS inline, no external
   scripts, no remote images.
6. **Tag** regions with `data-od-id="cover"`, `"letter"`, `"numbers"`,
   `"revenue"`, `"spotlight"`, `"board"`.
7. **Print safety**: an `@media print` block that removes shadows. Body
   text never smaller than 12px.

## Self-check

- Every stat has a number and a plain-language label.
- Chart percentages add to 100.
- Names carry titles; no anonymous "Board Member".
- No placeholder text. No em dashes, no arrow glyphs, no "AI".

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="fhcoc-annual-report" type="text/html" title="Annual Report Title">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact, nothing after.
