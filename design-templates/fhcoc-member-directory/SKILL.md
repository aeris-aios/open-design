---
name: fhcoc-member-directory
en_name: Member Directory
description: |
  The public chamber member directory: a search band, category filter
  pills, a results header, and a grid of member business cards carrying a
  monogram tile, category badge, one-line description, address, phone,
  and a listing link. Use when the brief asks for a "member directory",
  "business directory", "listing page", or "find a business page".
en_description: |
  A chamber member directory page with search, category filters, and a
  grid of member business cards.
triggers:
  - "member directory"
  - "business directory"
  - "listing page"
  - "find a business"
  - "member listing"
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
  example_prompt: "Build the public member directory page, with a search band, category filters, and a grid of member business cards showing category, address, and phone."
---

# Chamber Member Directory Skill

A directory earns its keep by making one business easy to find and easy to
call. Density is the point, but every card still has to breathe.

## Workflow

1. **Read the active DESIGN.md** (injected above). Navy `--meta` for
   structure and headings, orange `--accent` for the one active filter and
   the join button, Poppins throughout.
2. **Generate real listings.** Nine to twelve businesses with specific
   names, categories, one-line descriptions, street addresses, and phone
   numbers. Never "Business Name" or "Category".
3. **Lay out**, top to bottom:
   - **Header** — chamber mark, section links, one orange join button.
   - **Search band** on the warm surface: navy headline, one line of copy,
     a styled search field with a solid orange search button, and a row of
     category filter pills with exactly one in the active orange state.
   - **Results header** — the count and the sort order, in muted type.
   - **Card grid** — three columns at desktop, two at tablet, one at
     phone. Each card: a monogram tile built from the business initials on
     a navy or warm ground, the name, a category badge, one line of
     description, address, phone, and a quiet "View listing" link ending in
     a chevron. Two or three cards may carry a small orange member-tier
     badge; pair the color with a word, never color alone.
   - **Join band** — a navy panel with a white headline, one line, and one
     orange button.
   - **Footer** — chamber address, phone, website.
4. **Write** one self-contained HTML document, all CSS inline, no external
   scripts, no remote images. Monogram tiles are CSS, not images.
5. **Tag** regions with `data-od-id="header"`, `"search"`, `"results"`,
   `"grid"`, `"join"`, `"footer"`.

## Self-check

- Every card has a phone number and an address that could be dialled and
  driven to.
- Filter pills are 44px tall and center their content.
- No placeholder text. No em dashes, no arrow glyphs, no "AI".
- Card hover changes border and shadow only, never layout.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="fhcoc-member-directory" type="text/html" title="Directory Title">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact, nothing after.
