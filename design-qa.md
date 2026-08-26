# Go Plan Sunset Dialog Design QA

## Evidence

- Source visual truth: `/Users/william/Desktop/opendesign-go-sunset-modal-html 2/index.html`
- Source screenshot: `.tmp/design-qa/go-plan-sunset/reference-1440x900.png`
- Implementation screenshot: `.tmp/design-qa/go-plan-sunset/implementation-final-1440x900.png`
- Full-view comparison: `.tmp/design-qa/go-plan-sunset/full-comparison-final.png`
- Focused modal comparison: `.tmp/design-qa/go-plan-sunset/modal-comparison-final.png`
- Mobile comparison: `.tmp/design-qa/go-plan-sunset/mobile-comparison-final.png`
- Desktop viewport: 1440 x 900 CSS px, device scale factor 1; both captures are 1440 x 900 pixels.
- Mobile viewport: 390 x 844 CSS px, device scale factor 1; both captures are 390 x 844 pixels.
- State: Simplified Chinese, targeted unread `go-plan-sunset-2026-08` message, modal open on Home.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: Albert Sans is loaded by the product already. Title, subtitle, announcement, closing copy, and actions match the reference sizes, weights, line heights, letter spacing, and wrapping at both viewports.
- Spacing and layout rhythm: desktop panel measures 520 x 524.59 px in both captures. Its 56/44/36 px copy padding, 20 px radius, card geometry, 34 px close control, and 132 px/action-grid split match. Mobile measures 366 x 525.34 px in both captures and remains centered, matching the rendered reference HTML.
- Colors and visual tokens: white panel, `#11120f` ink, muted copy, `#f2f8ef` announcement surface, `#dff4d9` number chips, `#78ea57` primary action, overlay opacity, blur, radius, and shadow match the source literals.
- Image quality and asset fidelity: the modal contains no illustrative assets. The live app remains visible behind the implementation, while the reference uses its supplied static Home screenshot; this expected background-content difference does not affect modal fidelity.
- Copy and content: title, apology, three decisions, closing statement, and both action labels match the final HTML. The HTML's language switch and reopen control are demo-page controls outside the modal, so they are intentionally not added to the product dialog.

Focused-region comparison was required because the typography and compact announcement rows are too small to judge reliably in the full 1440 px view. The focused comparison places the two 520 x 525 modal crops side by side.

## Comparison History

1. Initial implementation capture found P2 drift: a legacy global `.modal h2` rule overrode the title to 18 px, and the shared icon-button rule forced the close control to 36 px with a 4 px radius. Increased component-local selector specificity restored the reference's 30 px title and 34 px circular close control.
2. Desktop pass matched the reference geometry, but the 390 px comparison found P2 responsive drift: shared Dialog `max-width` reduced the panel to 358 px and mobile flex alignment placed it at the viewport bottom. The component now overrides max width and preserves the reference HTML's effective centered placement. The final mobile panel is 366 x 525.34 px in both captures.
3. Final desktop and mobile captures show no remaining P0/P1/P2 mismatch. Primary acknowledgement was tested against a mocked successful read endpoint; the dialog closed and no browser console errors were reported.

## Implementation Checklist

- [x] Match final desktop dialog geometry and styling.
- [x] Match final mobile dialog geometry and wrapping.
- [x] Preserve close, acknowledgement, attribution, analytics, and fail-closed read behavior.
- [x] Verify final copy with a focused component test.
- [x] Check browser console errors.

## Follow-up Polish

None required for fidelity. The reference-only language switch and reopen button remain intentionally excluded from the production surface.

final result: passed
