---
name: fhcoc-renewal-notice
en_name: Membership Renewal Notice
description: |
  A membership renewal notice and invoice on one letter sheet: bill-to and
  invoice details, a renewal-due status band, dues and add-on line items
  with any early-renewal discount, the total due, what dues cover, and a
  pay-online block. Use when the brief asks for a "renewal notice", "dues
  invoice", "membership invoice", "statement", or "renewal letter".
en_description: |
  A one-sheet chamber membership renewal invoice with line items, totals,
  a status band, and a pay-online block.
triggers:
  - "renewal notice"
  - "dues invoice"
  - "membership invoice"
  - "renewal letter"
  - "statement"
  - "invoice"
od:
  featured: 0.02
  mode: prototype
  platform: desktop
  scenario: finance
  preview:
    type: html
    entry: example.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Draft the 2027 renewal invoice for a Silver tier member, with dues, an extra directory listing, an event booth deposit, a newsletter banner, the early renewal discount, and the total due."
---

# Chamber Renewal Notice Skill

A billing document that still sounds like a neighbour. Correct arithmetic
first, warmth second, and exactly one way to pay.

## Workflow

1. **Read the active DESIGN.md** (injected above). Navy `--meta` for the
   masthead, totals, and table head. Orange `--accent` appears twice at
   most: the rule above the total and the pay block. Poppins throughout.
2. **Pull the facts** and invent specific values where the brief is
   silent: invoice number, invoice date, due date, member name and
   address, member ID, member-since year, tier, line items, discount, and
   the payment URL.
3. **Lay out** on one letter-proportioned sheet (`aspect-ratio: 8.5 / 11`)
   centered on the warm ground:
   - **Masthead** — navy band, chamber mark left, document type and
     invoice number right.
   - **Bill-to and details** — two columns, labels in muted small caps.
   - **Status band** — a warm panel with a badge and one plain sentence
     naming what lapses if the due date passes.
   - **Line items** — description, period, amount. Then subtotal, any
     discount as a negative amount, and the total due set large in navy
     under an orange rule.
   - **What your dues cover** — three short items so the invoice also
     sells the renewal.
   - **Payment** — one orange call-to-action block, the URL beneath it,
     and one line about paying by check.
   - **Footer** — chamber address, phone, website, tax ID, and the
     deductibility disclosure.
4. **Arithmetic must be right.** Subtotal equals the sum of line items;
   the total equals subtotal minus discount. Align every amount to the
   right and set them in tabular figures.
5. **Write** one self-contained HTML document, all CSS inline, no external
   scripts, no remote images.
6. **Tag** regions with `data-od-id="masthead"`, `"billto"`, `"status"`,
   `"items"`, `"total"`, `"payment"`, `"footer"`.
7. **Print safety**: an `@media print` block that removes shadows and
   keeps the notice on one sheet. Body text never smaller than 12px.

## Self-check

- The total is the largest number on the page and the due date is next to
  it or above it.
- Exactly one payment destination.
- No placeholder text. No em dashes, no arrow glyphs, no "AI".

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="fhcoc-renewal-notice" type="text/html" title="Renewal Notice Title">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact, nothing after.
