---
name: fhcoc-event-flyer
en_name: Chamber Event Flyer
description: |
  A single-page chamber event flyer or poster — navy masthead with the
  chamber mark, an oversized event title, an orange accent bar, a
  date / time / venue block, a short pitch, ticket or price tiers, a
  sponsor strip, and one call to action. Built for mixers, ribbon
  cuttings, Oktoberfest, the golf tournament, and State of the Town.
  Use when the brief asks for an "event flyer", "event poster",
  "mixer flyer", "ribbon cutting announcement", or "printable event
  one-sheet".
en_description: |
  A single-page chamber event flyer or poster: navy masthead, oversized
  event title, orange accent bar, date / time / venue block, ticket
  tiers, sponsor strip, and one call to action.
triggers:
  - "event flyer"
  - "event poster"
  - "mixer flyer"
  - "ribbon cutting"
  - "chamber event"
  - "oktoberfest flyer"
  - "golf tournament flyer"
  - "printable flyer"
od:
  featured: 0.01
  mode: prototype
  platform: desktop
  scenario: marketing
  preview:
    type: html
    entry: example.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Design a flyer for the Business After Hours mixer on the third Thursday — host business, time, address, member and guest pricing, and an RSVP line."
  example_prompt_i18n:
    en: "Design a flyer for the Business After Hours mixer on the third Thursday — host business, time, address, member and guest pricing, and an RSVP line."
---

# Chamber Event Flyer Skill

Produce one printable, single-page event flyer. It has to survive being
printed on a home printer, taped to a shop window, and posted as a JPEG,
so contrast and hierarchy matter more than decoration.

## Workflow

1. **Read the active DESIGN.md** (injected above). Every color, font, and
   radius comes from it. Do not invent tokens. For the Fountain Hills
   Chamber system that means navy `--meta` for structure, orange
   `--accent` used once as the focal move, Poppins throughout.
2. **Pull the facts out of the brief**: event name, date, start and end time, venue name,
   street address, price (member vs. guest, or "free"), RSVP or ticket
   destination, and the host or presenting sponsor. Use only what the brief
   supplies. If it omits one, leave that block out and let the layout
   close up, then name the omission plainly after the artwork. Never
   substitute a plausible-looking value: this is published to the town,
   and an invented venue, price or phone number is a correction the
   chamber has to issue. See the Facts section of DESIGN.md.
3. **Lay out**, top to bottom, on a portrait page (`aspect-ratio: 8.5 / 11`
   or `210 / 297`):
   - **Masthead** — a solid navy band. Chamber wordmark on the left, a
     small kicker on the right ("Fountain Hills, Arizona" or the series
     name). Keep the band 12-16% of the page height.
   - **Eyebrow** — one short uppercase line with wide tracking naming the
     event series ("BUSINESS AFTER HOURS", "RIBBON CUTTING").
   - **Title** — the event name, 2-3 lines maximum, display weight 600,
     `line-height: 1.05`, slight negative tracking. This is the only
     thing readable from across a room.
   - **Accent rule** — a short orange bar (roughly 96px x 6px) under the
     title. This is the one accent moment; do not repeat it.
   - **Detail block** — date, time, and venue as three labelled rows or a
     three-column strip. Label in muted small caps, value in body weight.
     Never bury the address in a paragraph.
   - **Pitch** — two or three sentences on why to come. Plain and warm,
     no hype, no em dashes.
   - **Price / tiers** — a row of 2-3 pill cards (Member, Guest, Table of
     eight). Each card: tier name, price, one qualifying line.
   - **Call to action** — one filled orange button-shaped block with the
     verb first ("Reserve your seat"), plus the URL or phone below it in
     smaller type. Exactly one CTA.
   - **Sponsor strip** — a bottom band on the warm panel color with
     "Presented by" and 3-5 sponsor name plates. Plates are text, not
     logos; use a bordered rounded rectangle per sponsor.
   - **Footer rule** — chamber address, phone, and website on one line.
4. **Write** one self-contained HTML document — `<!doctype html>` through
   `</html>`, all CSS in one inline `<style>` block, no external scripts,
   no remote images. Any imagery is CSS: gradients, a duotone wash, or an
   inline SVG mark.
5. **Tag** each region with `data-od-id="masthead"`, `"title"`,
   `"details"`, `"tiers"`, `"cta"`, `"sponsors"` so comment mode can
   anchor to it.
6. **Print safety**: add an `@media print` block that removes shadows and
   forces the page to one sheet. Body text never smaller than 12px.

## Self-check

- Orange appears at most twice: the accent rule and the CTA.
- The date and the venue are legible at 25% zoom.
- No placeholder text anywhere. No "Lorem", no "TBD", no "Event Name".
- The CTA is a single destination.
- Nothing loads from the network.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="fhcoc-event-flyer" type="text/html" title="Event Flyer Title">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact, nothing after.
