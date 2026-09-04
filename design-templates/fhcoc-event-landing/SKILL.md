---
name: fhcoc-event-landing
en_name: Event Registration Page
description: |
  A chamber event registration page: sticky header, a hero carrying the
  event name, dates, and venue, an at-a-glance card, an attendance stat
  strip, a "what's on" row, ticket tiers, a day-by-day schedule, a
  sponsor strip, and one registration call to action. Use when the brief
  asks for an "event page", "registration page", "ticket page", "event
  landing", or "sign-up page" for a chamber event.
en_description: |
  A chamber event landing page with hero, at-a-glance card, stat strip,
  programme, ticket tiers, schedule, sponsors, and one registration CTA.
triggers:
  - "event page"
  - "registration page"
  - "ticket page"
  - "event landing"
  - "sign up page"
  - "oktoberfest page"
  - "golf tournament page"
od:
  featured: 0.02
  mode: prototype
  platform: desktop
  scenario: marketing
  preview:
    type: html
    entry: example.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Build the registration page for the chamber Oktoberfest: dates, gates, parking, admission, the three-day schedule, ticket tiers, and the presenting partners."
---

# Chamber Event Registration Page Skill

One scrolling page whose only job is to turn a visitor into a registration.
Everything above the fold answers what, when, where, and how much.

## Workflow

1. **Read the active DESIGN.md** (injected above). Every color, font, and
   radius comes from it. For the Fountain Hills Chamber system that means
   navy `--meta` for structure, orange `--accent` for the single primary
   action, Poppins throughout.
2. **Pull the facts out of the brief**: event name, dates, gate times, venue name and street
   address, parking, admission prices by tier, and the registration
   destination. Use only what the brief
   supplies. If it omits one, leave that block out and let the layout
   close up, then name the omission plainly after the artwork. Never
   substitute a plausible-looking value: this is published to the town,
   and an invented venue, price or phone number is a correction the
   chamber has to issue. See the Facts section of DESIGN.md.
3. **Lay out**, top to bottom:
   - **Header** — chamber mark on the left, four section links, one solid
     orange button on the right. A slim navy utility bar above it can
     carry the date line.
   - **Hero** — eyebrow, navy headline, a two or three sentence pitch,
     one primary orange button plus one quiet secondary, and a right-hand
     "at a glance" card listing dates, gates, parking, and admission.
   - **Stat strip** — three or four numbers that make the event feel real
     (days, vendors, exhibitors, last year's attendance).
   - **What's on** — a three-card row, each with a heading and two
     sentences. No icons unless they are inline SVG.
   - **Ticket tiers** — two to four pill cards, one of them the warm
     highlighted member tier. Tier name, price, one qualifying line.
   - **Schedule** — one block per day, each with three or four time and
     item rows on a hairline-separated list.
   - **Sponsors** — "Presented by" plus bordered text nameplates.
   - **Footer** — navy, with the chamber address, phone, website, and the
     brand line.
4. **Write** one self-contained HTML document, `<!doctype html>` through
   `</html>`, all CSS in one inline `<style>`, no external scripts, no
   remote images. Imagery is CSS gradients or inline SVG.
5. **Tag** each region with `data-od-id="header"`, `"hero"`, `"stats"`,
   `"programme"`, `"tiers"`, `"schedule"`, `"sponsors"`, `"footer"`.
6. **Responsive**: the 1160px container collapses to one column under
   860px. Buttons stay 44px tall.

## Self-check

- Exactly one primary orange button style, repeated at most twice.
- The date, venue, and price are readable without scrolling.
- No placeholder text anywhere. No "Lorem", no "TBD", no "Event Name".
- No em dashes, no arrow glyphs, and the word "AI" appears nowhere.
- Nothing loads from the network except the font.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="fhcoc-event-landing" type="text/html" title="Event Page Title">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact, nothing after.
