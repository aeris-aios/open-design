# Block Frame Slides style system

This is the detailed source specification adapted from the selected OpenDesign deck. In this standalone skill, the canonical seed is `../assets/template.html`; plugin registration is not required.

> Portability note: the historical source notes below may mention a plugin, an artifact wrapper, or the old `example.html` path. For this standalone skill, follow the root `SKILL.md` for packaging and output; use the material below only as the authoritative visual and layout specification.

## Selection summary

- Visual signature: hard-edged frames, paper panels, black rules, saturated blocks, and editorial collage.
- Best for: design audits, creative briefs, portfolios, and transformation narratives.
- Avoid for: soft wellness or minimal luxury decks.

---

# BlockFrame

> Neobrutalist deck with pastel-neon color blocks and chunky black borders.

A single self-contained HTML deck — typography, palette, decorative system,
and slide vocabulary are all tuned together. Mixing layouts across templates
breaks the system; stay inside this one.

## At a glance

- **Scheme:** light
- **Formality:** medium-low
- **Density:** high
- **Slides in demo:** 10

## Best for

Anything that should feel pop-graphic and design-led: indie SaaS launches, agency credentials, creative reviews, brand redesigns. Also a strong unexpected pick for tech, finance, or research when the speaker wants to land as confident and contemporary rather than buttoned-up.

## Avoid for

Contexts that require quiet institutional restraint or traditional weight (regulated disclosures, formal legal briefs).

## Workflow

1. **Clone `assets/template.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real headlines, body copy,
   numbers, names, dates, and section labels. Match existing dimensions when
   swapping image placeholders.
3. **Preserve the design system.** Never substitute fonts, recolor the palette,
   restructure the layout grid, or strip decorative elements (corner brackets,
   paper grain, geometric shapes, illustrated SVGs). They are part of the
   identity.
4. **Adjust deck length by duplicating layouts.** If the user has more content
   than the demo holds, duplicate an existing slide of the most appropriate
   layout. If less, drop slides from the bottom. Update page-number labels.
5. **Designing missing layouts:** if a slide needs a layout the template
   doesn't have, design it from scratch using the same fonts, palette,
   decorative vocabulary, spacing rhythm, and component grammar — never bail
   to a different template.
6. **Keep the navigation runtime as shipped.** If the deck ships an
   `assets/deck-stage.js` or inline keyboard handler, leave it intact.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="zhangzara-block-frame" type="text/html" title="Deck Title">
<!doctype html>
<html>...</html>
</artifact>
```

## Source & license

Vendored from upstream MIT-licensed
[`zarazhangrui/beautiful-html-templates`](https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/block-frame).

The full upstream MIT license text — including the original copyright notice — ships in this skill at
[`LICENSE`](../LICENSE) and must be redistributed alongside any copy of `assets/template.html`,
`template.json`, or any vendored `assets/` runtime. See `template.json` for the upstream metadata snapshot.
