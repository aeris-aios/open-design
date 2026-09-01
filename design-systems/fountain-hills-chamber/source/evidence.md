# Fountain Hills Chamber Source Evidence

## Source Scope

This Design System 2.0 package is authored from the Fountain Hills Chamber of Commerce brand kit
that ships with the Commerce Fountain platform. It does not claim a crawl of a public brand
repository or website; the bindings are hand-authored and committed here as the bundled fixture.

## Included Fixture Files

- design-systems/fountain-hills-chamber/DESIGN.md
- design-systems/fountain-hills-chamber/tokens.css
- design-systems/fountain-hills-chamber/components.html

## Brand Anchors

- Accent orange `#ed7d36`, hover `#d96a26`, active `#c25c1f`, soft wash `#fdeadd`.
- Brand navy `#054d87`, deepened `#032f54`, soft `#e3eef7`.
- Grounds: white `#ffffff`, warm off-white `#faf7f4`. Text: slate `#334155`, strong `#0f172a`.
- Semantic: success `#16a34a`, warning `#d97706`, danger `#dc2626`.
- Poppins for display and body, with a system sans fallback.

## Token Contract

`source/token-contract.report.json` maps every TOKEN_SCHEMA binding back to the committed `tokens.css` declaration line.
`design-tokens.json` and `tailwind-v4.css` are derived outputs and should be regenerated from the report and token stylesheet rather than edited by hand.
`components.manifest.json` is a rebuildable cache derived from `components.html` plus `tokens.css`.
