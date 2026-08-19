import { describe, expect, it } from "vitest";

import { previewNavigationFailureFromDidFailLoad } from "../../src/main/runtime.js";

describe("preview navigation failure forwarding", () => {
  it("forwards only aborted about:srcdoc subframe navigations", () => {
    expect(previewNavigationFailureFromDidFailLoad({
      errorCode: -3,
      eventId: 1,
      frameName: "od-artifact-preview-srcdoc",
      isMainFrame: false,
      occurredAtMs: 1234,
      validatedUrl: "about:srcdoc",
    })).toEqual({
      errorCode: -3,
      eventId: 1,
      frameName: "od-artifact-preview-srcdoc",
      occurredAtMs: 1234,
      validatedUrl: "about:srcdoc",
    });

    expect(previewNavigationFailureFromDidFailLoad({
      errorCode: -3,
      eventId: 2,
      isMainFrame: true,
      occurredAtMs: 1235,
      validatedUrl: "about:srcdoc",
    })).toBeNull();
    expect(previewNavigationFailureFromDidFailLoad({
      errorCode: -6,
      eventId: 3,
      isMainFrame: false,
      occurredAtMs: 1236,
      validatedUrl: "about:srcdoc",
    })).toBeNull();
    expect(previewNavigationFailureFromDidFailLoad({
      errorCode: -3,
      eventId: 4,
      isMainFrame: false,
      occurredAtMs: 1237,
      validatedUrl: "https://example.com/",
    })).toBeNull();
  });
});
