# People's Platform Slides style system

This is the detailed source specification adapted from the selected OpenDesign deck. In this standalone skill, the canonical seed is `../assets/template.html`; plugin registration is not required.

> Portability note: the historical source notes below may mention a plugin, an artifact wrapper, or the old `example.html` path. For this standalone skill, follow the root `SKILL.md` for packaging and output; use the material below only as the authoritative visual and layout specification.

## Selection summary

- Visual signature: high-energy programme green, dark-blue serif type, numbered ledger rows, and public-information poster structure.
- Best for: campaigns, programmes, community plans, and public-interest narratives.
- Avoid for: quiet luxury or monochrome executive briefs.

---

# People's Platform (Block & Bold)

> Activist poster energy: blue, orange, red on cream, with Alfa Slab + Caveat Brush.

A single self-contained HTML deck — typography, palette, decorative system,
and slide vocabulary are all tuned together. Mixing layouts across templates
breaks the system; stay inside this one.

## At a glance

- **Scheme:** light
- **Formality:** medium-low
- **Density:** medium-high
- **Slides in demo:** 10

## Best for

Anything that should feel honest, loud, and graphic: cultural commentary, manifestos, civic and community decks, design talks, campaign pitches. Excellent for founder-vision moments, mission statements, or any deck — including across industries — that wants protest-poster energy instead of corporate polish.

## Avoid for

Contexts where institutional restraint is the actual goal — the saturated political-poster palette commits hard to expressive energy.

## Workflow

1. **Clone `assets/template.html`** into the user's workspace. The keyboard,
   stage-scaling, and navigation runtime is already inlined, so the file is
   self-contained.
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
6. **Keep the inlined navigation runtime as shipped.**

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="zhangzara-peoples-platform" type="text/html" title="Deck Title">
<!doctype html>
<html>...</html>
</artifact>
```

## Source & license

Vendored from upstream MIT-licensed
[`zarazhangrui/beautiful-html-templates`](https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/peoples-platform).

The full upstream MIT license text — including the original copyright notice — ships in this skill at
[`LICENSE`](../LICENSE) and must be redistributed alongside any copy of `assets/template.html`,
`template.json`, or any vendored `assets/` runtime. See `template.json` for the upstream metadata snapshot.
