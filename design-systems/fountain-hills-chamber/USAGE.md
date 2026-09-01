# Fountain Hills Chamber Usage

Design System 2.0 package guide for OpenDesign agents and reviewers.

## Read Order

1. Read this file first to understand the package contract.
2. Read `DESIGN.md` for visual intent, constraints, and anti-patterns.
3. Paste `tokens.css` into the first artifact `<style>` block before writing component CSS.
4. Use `components.manifest.json` for the compact component inventory; open `components.html` when exact selectors or states matter.
5. Inspect `preview/` pages when a visual sanity check is useful.

## Design Highlights

- Visual style: clean civic professional
- Color stance: accent, brand, neutral, success, warning, danger
- Design intent: warm fountain orange over deep civic navy, Poppins throughout, soft shadows and generous whitespace.
- Accent: `#ed7d36` bound to `--accent`; brand navy `#054d87` bound to `--meta`.

## Do

- Preserve the schema token names exactly so cross-brand switching stays reliable.
- Use `--accent` for one focal action per composition; use `--meta` navy for headings, links, and structure.
- Set every face in Poppins: headings 600, body 400, labels and pills 500.
- Keep radii in the 10 to 16px family and elevation on the single soft navy shadow.
- Reuse component groups from `components.manifest.json` before inventing new controls.
- Write "AERIS" for the assistant, and use a chevron for forward links.

## Avoid

- Avoid raw hex values outside the copied `:root` token block.
- Avoid redefining Tailwind or design-token values independently of `tokens.css`.
- Avoid a second accent, orange body copy, hard drop shadows, or display and condensed faces.
- Avoid em dashes and arrow glyphs in copy, and avoid writing "AI" in user-facing text.
- Avoid adding new component recipes that are not represented in `components.html` or `DESIGN.md`.
