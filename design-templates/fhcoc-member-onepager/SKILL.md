---
name: fhcoc-member-onepager
en_name: Member & Sponsor One-Pager
description: |
  A print-ready chamber one-pager for membership benefits, sponsorship
  packets, renewal notices, and advertising rate cards. Navy header,
  a short value paragraph, a benefits grid, a tier comparison table
  with one recommended column, a proof strip, and one signup action.
  Use when the brief asks for a "benefits one-pager", "sponsorship
  packet", "membership tiers", "rate card", or "renewal notice".
en_description: |
  A print-ready chamber one-pager: navy header, value paragraph, benefits
  grid, tier comparison table with one recommended column, proof strip,
  and one signup action.
triggers:
  - "member benefits"
  - "one-pager"
  - "sponsorship packet"
  - "membership tiers"
  - "rate card"
  - "renewal notice"
  - "sponsor levels"
  - "dues"
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
  example_prompt: "Build a member benefits one-pager comparing the four chamber tiers, what each includes, annual dues, and how to join."
  example_prompt_i18n:
    en: "Build a member benefits one-pager comparing the four chamber tiers, what each includes, annual dues, and how to join."
---

# Member & Sponsor One-Pager Skill

Produce one letter-size sheet a staff member can hand across a table or
attach to an email. It sells one decision: join, renew, or sponsor.

## Workflow

1. **Read the active DESIGN.md** (injected above). Structure in navy,
   one orange focal move, warm off-white panels, Poppins throughout.
2. **Decide the single ask** from the brief: join, renew, sponsor, or
   advertise. Everything on the sheet points at that one ask.
3. **Lay out**, top to bottom, on `aspect-ratio: 8.5 / 11`:
   - **Header band** — navy. Chamber wordmark left, document type right
     ("2026 Membership", "Sponsorship Packet"). Below the wordmark, the
     tagline in a lighter weight.
   - **Lede** — a headline of 5-9 words plus a two-sentence paragraph
     saying what the member gets and who it is for.
   - **Benefits grid** — 6 cards in a 3x2 grid. Each card: a small
     numbered or lettered marker, a 2-4 word benefit name, and one
     sentence. Markers use the accent; card bodies stay neutral.
   - **Tier table** — 3-4 columns (for example Associate, Business,
     Premier, Champion). Each column: tier name, annual price, a short
     "best for" line, and 4-6 checked inclusions. Mark exactly one
     column recommended with a small "Most chosen" pill and a subtle
     accent border. Do not tint more than one column.
   - **Proof strip** — three numbers on the warm panel (member count,
     events per year, referrals passed) with short labels underneath.
   - **Close** — a two-column footer: left, a short "How to join" list
     of three numbered steps; right, one filled orange action block with
     the URL and the staff contact.
   - **Footer rule** — chamber address, phone, site, and the document
     revision date.
4. **Write** one self-contained HTML document, all CSS in one inline
   `<style>` block, no scripts, no remote assets. Checkmarks are inline
   SVG or a styled character, never an icon font.
5. **Tag** regions with `data-od-id="header"`, `"benefits"`, `"tiers"`,
   `"proof"`, `"close"`.
6. **Print safety**: an `@media print` block that drops shadows, keeps
   the sheet to one page, and preserves the navy header via
   `print-color-adjust: exact`.

## Self-check

- Exactly one recommended tier and exactly one action block.
- Every price, count, and benefit is specific. No "TBD", no "$X".
- The tier table survives a 900px viewport by scrolling inside its own
  container, never by breaking the page.
- Body copy has no em dashes and never says "AI".
- Nothing loads from the network.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="fhcoc-member-onepager" type="text/html" title="One-Pager Title">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact, nothing after.
