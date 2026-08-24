# Editorial Tri-Tone Slides style system

This is the detailed source specification adapted from the selected OpenDesign deck. In this standalone skill, the canonical seed is `../assets/template.html`; plugin registration is not required.

> Portability note: the historical source notes below may mention a plugin, an artifact wrapper, or the old `example.html` path. For this standalone skill, follow the root `SKILL.md` for packaging and output; use the material below only as the authoritative visual and layout specification.

## Selection summary

- Visual signature: cream, mustard, burgundy, large chapter numerals, and split editorial columns.
- Best for: research briefs, policy reviews, cultural strategy, and magazine narratives.
- Avoid for: neon technology launches or playful onboarding.

---

# Editorial Tri-Tone

> Three-color editorial system: dusty pink, mustard cream, and deep burgundy, set in Bricolage + Instrument Serif.

A single self-contained HTML deck — typography, palette, decorative system,
and slide vocabulary are all tuned together. Mixing layouts across templates
breaks the system; stay inside this one.

## At a glance

- **Scheme:** mixed
- **Formality:** medium-high
- **Density:** medium
- **Slides in demo:** 8

## Best for

Anything that should feel like a fashion-magazine spread: editorial pitches, fashion brand decks, lifestyle media, art direction reviews. Equally good for any deck — including tech, research, or business — that wants tri-tone discipline and serif/sans contrast instead of the usual neutrals.

## Avoid for

Decks that need to read as soft or comforting — the burgundy/pink/cream tri-tone is intentionally high-contrast and styled.

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
<artifact identifier="zhangzara-editorial-tri-tone" type="text/html" title="Deck Title">
<!doctype html>
<html>...</html>
</artifact>
```

## Source & license

Vendored from upstream MIT-licensed
[`zarazhangrui/beautiful-html-templates`](https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/editorial-tri-tone).

The full upstream MIT license text — including the original copyright notice — ships in this skill at
[`LICENSE`](../LICENSE) and must be redistributed alongside any copy of `assets/template.html`,
`template.json`, or any vendored `assets/` runtime. See `template.json` for the upstream metadata snapshot.
