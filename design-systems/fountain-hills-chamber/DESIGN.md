# Fountain Hills Chamber of Commerce

> Category: Professional & Corporate
> Warm fountain orange over deep civic navy, Poppins throughout, clean and professional with generous whitespace.

The brand of the Fountain Hills Chamber of Commerce (Arizona) and its platform,
Commerce Fountain. Warm, civic, and professional: a desert-sunset orange carries
energy; a deep water navy carries trust. The fountain is the town's landmark and
the brand's central metaphor, "Where Business, Community, and Opportunity Flow."

## Voice

- Friendly, plain, professional. Short sentences. No hype.
- The platform's assistant is named **AERIS**, never write "AI" in any copy.
- No em dashes in copy. Use commas or a period. Chevrons, never arrow glyphs.
- Labels are literal: "Become a member", "Reserve a seat", "Open the directory".
  Avoid clever headings that hide what the control does.

## Color

- **Accent orange `#ed7d36`** for calls to action, highlights, one accent per
  composition. Never use it for long body text. Bound to `--accent`, with
  `#d96a26` on hover (`--accent-hover`) and `#c25c1f` on press
  (`--accent-active`).
- **Brand navy `#054d87`** for headlines, structure, footers, depth. The
  authority color. Bound to `--meta` and used for links, eyebrows, and the
  shadow tint.
- Neutrals: white `#ffffff` grounds (`--bg`), warm off-white `#faf7f4` panels
  (`--surface`), slate `#334155` body text (`--fg-2`), `#0f172a` strong text
  (`--fg`), `#64748b` captions (`--muted`).
- Tints: warm `#fdeadd` (`--surface-warm`) for soft accent washes, navy-soft
  `#e3eef7` (`--border-soft`) for inner separators and quiet badges.
- Dark compositions: navy ground (`#054d87` or deepened `#032f54`), white
  text, orange accents. Light compositions: white ground, navy headlines,
  orange accents.
- Semantic: success `#16a34a`, warning `#d97706`, danger `#dc2626`. Reserve
  them for state, never for decoration.

## Typography

- **Poppins** everywhere. Headlines SemiBold (600), body Regular (400),
  labels and pills Medium (500). Fall back to system sans through
  `ui-sans-serif, system-ui, sans-serif`.
- Headlines set tight (`--leading-tight: 1.15`) with slight negative tracking
  (`--tracking-display: -0.02em`) on large sizes. Body reads at
  `--leading-body: 1.55`.
- Scale runs 12 / 14 / 16 / 18 / 24 / 32 / 44 / 60px. Jump at least two steps
  between a headline and its supporting text so hierarchy is obvious.
- Never use display, script, or condensed faces. No all-caps body copy;
  uppercase is reserved for the small eyebrow label.

## Layout & shape

- Generous whitespace; compositions breathe. One focal point per piece.
  Sections use 96 / 72 / 48px vertical rhythm across desktop, tablet, phone.
- Content sits in a 1160px container with 32 / 24 / 16px gutters.
- Rounded corners in a 10 to 16px radius family (`--radius-sm` 10px,
  `--radius-md` 12px, `--radius-lg` 16px). Pills use `--radius-pill`.
- Soft shadows only, never hard drops. The single elevation is
  `0 8px 24px rgba(5, 77, 135, 0.1)`, a navy-tinted lift.
- Pills and badges center their content.
- Event flyers and social graphics: bold navy headline, orange accent bar or
  shape, clear date/time/venue block, single call to action.

## Components

- **Buttons** are 44px minimum height with a 12px radius and centered content.
  Primary is solid orange on white text; secondary is a white surface with a
  navy label and a hairline border that warms to orange on hover.
- **Fields** share the button radius and height. Focus is an orange ring
  (`--focus-ring`) plus an orange border, never a heavy double ring.
- **Cards** are white on the white ground, separated by the hairline border and
  the soft navy shadow. Warm cards swap the ground for `--surface-warm` and drop
  the shadow so only one card in a group draws focus.
- **Badges** read as quiet status: navy-soft ground for neutral, warm ground for
  accent, semantic color for active, renewing, or lapsed membership.
- **Links** carry a navy label and a soft underline that warms on hover. A
  forward link appends a chevron, never an arrow glyph.

## Motion & interaction

- Micro-states move at `--motion-fast` (150ms); state changes at
  `--motion-base` (200ms). Easing is always `cubic-bezier(0.2, 0, 0, 1)`.
- Animate color, border, and shadow. Do not animate layout, and do not slide
  content in on scroll.
- Every interactive element declares hover, focus-visible, active, and disabled.
  Focus-visible is keyboard-only and must never linger after a pointer click.

## Imagery

- Desert-southwest palette photography (Fountain Hills: the fountain, red
  rock, saguaro, golden hour). Duotone treatments in navy/orange work well.
- Logos get clear space equal to the mark's height; never stretch, recolor, or
  place the logo on low-contrast backgrounds.
- Photography carries the warmth, so the surrounding layout stays quiet. One
  image per composition unless a gallery is the point of the page.

## Accessibility

- Body text on white holds well above 4.5:1 at `--fg-2`; captions at `--muted`
  are for supporting text only, never for the sole copy of an instruction.
- Orange on white is a graphic and action color, not a text color. When orange
  must carry text, it sits as `--accent-on` white on the orange ground.
- Status is never color alone. Pair every semantic badge with a word.
- Hit targets stay at 44px or larger, including badges that act as filters.

## Anti-patterns

- Do not use two accents in one composition, and do not tint the accent to make
  a second one.
- Do not set body copy in orange, and do not set headlines in `--muted`.
- Do not add hard drop shadows, glows, gradients on text, or decorative bevels.
- Do not swap Poppins for a display, script, or condensed face for emphasis.
- Do not write "AI" in user-facing copy; the assistant is AERIS.
- Do not use em dashes or arrow glyphs in copy.
