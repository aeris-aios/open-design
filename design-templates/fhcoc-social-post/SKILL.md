---
name: fhcoc-social-post
en_name: Chamber Social Post Set
description: |
  A three-up set of 1080x1080 chamber social graphics on one board —
  a member spotlight, an event promo, and a membership drive card.
  Each square carries the chamber mark, one headline, one supporting
  line, and a single call to action, so the set drops straight into
  Instagram, Facebook, or LinkedIn. Use when the brief asks for a
  "social post", "member spotlight", "event promo graphic", "new member
  welcome", or "membership drive post".
en_description: |
  Three 1080x1080 chamber social graphics on one board: member spotlight,
  event promo, and membership drive. One headline, one support line, and
  one call to action per square.
triggers:
  - "social post"
  - "member spotlight"
  - "event promo graphic"
  - "new member welcome"
  - "membership drive"
  - "instagram post"
  - "facebook post"
  - "social graphic"
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
  example_prompt: "Make a three-post social set for the chamber: a member spotlight on a local bakery, an Oktoberfest ticket promo, and a fall membership drive."
  example_prompt_i18n:
    en: "Make a three-post social set for the chamber: a member spotlight on a local bakery, an Oktoberfest ticket promo, and a fall membership drive."
---

# Chamber Social Post Skill

Produce three 1080x1080 squares on one board. Each square has to work
alone in a feed and read as one family when the three sit together.

## Workflow

1. **Read the active DESIGN.md** (injected above). Colors, type, radius,
   shadow all come from it. One accent per square.
2. **Assign the three roles** from the brief. Default set when the brief
   is vague:
   - **Spotlight** — celebrate one member business. Light ground.
   - **Event** — promote one dated event. Navy ground (the loud one).
   - **Drive** — a membership or renewal push. Warm panel ground.
   Alternate the grounds so the three read as a set, not a repeat.
3. **Build the board** — a page header (small chamber wordmark, one line
   of context, a "3 posts / 1080 x 1080" stamp on the right), then the
   three squares in a row that wraps to a stack under 900px. Each square
   is `aspect-ratio: 1 / 1`, `--radius-lg` corners, `--elev-raised`.
4. **Inside every square**, in this order:
   - **Brand chip** — the chamber mark as a small pill, top left. A
     category tag ("MEMBER SPOTLIGHT", "EVENT", "JOIN") top right.
   - **Focal element** — one and only one:
     - Spotlight: a circular portrait slot (a gradient disc with the
       business initials) plus the business name and category.
     - Event: an oversized date lockup (month above, day numeral large).
     - Drive: a big numeral stat (member count, years serving).
   - **Headline** — 2-4 words, weight 600, tight leading, sized so the
     longest line spans about 80% of the square.
   - **Support line** — one sentence, 12-16 words. Warm and plain. No em
     dashes, no exclamation stacking.
   - **Call to action** — a single pill at the bottom. Verb first. On the
     navy square the pill is orange; on light squares the pill is navy
     with an orange left dot.
   - **Footer rule** — a hairline and the chamber handle or site.
5. **Write** one self-contained HTML document. All CSS inline in one
   `<style>` block. No remote images, no scripts. Portrait slots and
   textures are CSS gradients or inline SVG.
6. **Tag** each square with `data-od-id="post-spotlight"`,
   `"post-event"`, `"post-drive"`.

## Self-check

- Every square is exactly square at any viewport width.
- The headline is legible when the square is scaled to 120px wide.
- Each square has one CTA and one accent moment.
- Real business names, real dates, real numbers. No placeholders.
- Nothing loads from the network.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="fhcoc-social-post" type="text/html" title="Social Post Set Title">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact, nothing after.
