---
name: fhcoc-newsletter
en_name: Chamber Newsletter
description: |
  The monthly chamber email newsletter — centered single column on a
  tinted page, navy masthead with issue and date, a director's note,
  an upcoming-events list with dated chips, a member spotlight card,
  new-member welcomes, a numbers strip, a sponsor thank-you row, and a
  compliant footer. Use when the brief asks for a "newsletter",
  "monthly update", "member email", "e-blast", or "chamber digest".
en_description: |
  The monthly chamber email newsletter: navy masthead, director's note,
  dated events list, member spotlight, new-member welcomes, a numbers
  strip, sponsor thank-yous, and a compliant footer.
triggers:
  - "newsletter"
  - "monthly update"
  - "member email"
  - "e-blast"
  - "chamber digest"
  - "email newsletter"
  - "board update"
od:
  featured: 0.03
  mode: prototype
  platform: desktop
  scenario: marketing
  preview:
    type: html
    entry: example.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Write and design the October chamber newsletter: a note from the director, four upcoming events, one member spotlight, three new members, and the sponsor thank-you row."
  example_prompt_i18n:
    en: "Write and design the October chamber newsletter: a note from the director, four upcoming events, one member spotlight, three new members, and the sponsor thank-you row."
---

# Chamber Newsletter Skill

Produce one HTML email. Centered single column, 640px content width, on
a tinted page background so the body reads as an email rather than a web
page. Email clients are hostile: no flexbox gymnastics, no custom
properties inside the column, no external assets.

## Workflow

1. **Read the active DESIGN.md** (injected above) for the palette and
   type. Then **inline the resolved values** inside the email column —
   declare tokens once on `:root` for authoring, but write literal hex
   values on the email elements so Outlook and Gmail render correctly.
2. **Pick the month and the beats** from the brief. Generate real event
   names, real dates, real member businesses. No placeholders.
3. **Lay out**, top to bottom, inside a 640px centered table-safe column:
   - **Preheader** — one muted line above the masthead ("View in browser"
     on the right, the issue line on the left).
   - **Masthead** — navy block. Chamber wordmark, the tagline under it,
     and an issue stamp ("Issue 118 / October 2026") on the right.
   - **Director's note** — a small round avatar slot (initials on a
     gradient), a name and title, then two short paragraphs. Sign off
     with a first name.
   - **Upcoming events** — 3-5 rows. Each row: a dated chip on the left
     (month abbreviation over day numeral, navy on warm), then event
     name, one line of time and venue, and a chevron link. Chevrons
     only, never arrow glyphs.
   - **Member spotlight** — one card on the warm panel: business name,
     category, two sentences, and a short quote in a heavier weight.
   - **New members** — a welcome row of 3-4 small name plates.
   - **Numbers strip** — three stats on navy (new members this month,
     events hosted, ribbon cuttings) in a single row.
   - **Sponsor thank-you** — "Thank you to our 2026 partners" and 4-6
     bordered name plates.
   - **Footer** — chamber name, street address, phone, site, plus
     "Update preferences" and "Unsubscribe" links. Address and
     unsubscribe are required; never omit them.
4. **Write** one self-contained HTML document with all CSS in one inline
   `<style>` block plus inline styles on the email elements. No scripts,
   no remote images, no web fonts inside the column beyond the stack in
   DESIGN.md.
5. **Tag** regions with `data-od-id="masthead"`, `"note"`, `"events"`,
   `"spotlight"`, `"new-members"`, `"numbers"`, `"sponsors"`, `"footer"`.

## Self-check

- The column is 640px and centered at every viewport; it never scrolls
  horizontally on a phone.
- Orange is used for the section rules and one link treatment only.
- Every event has a date, a time, and a venue.
- Copy contains no em dashes and never says "AI"; the assistant is AERIS.
- Footer carries a postal address and an unsubscribe link.
- Nothing loads from the network.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="fhcoc-newsletter" type="text/html" title="Newsletter Title">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact, nothing after.
