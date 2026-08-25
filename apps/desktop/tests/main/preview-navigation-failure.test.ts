import { describe, expect, it } from "vitest";

import { previewNavigationFailureFromDidFailLoad } from "../../src/main/runtime.js";

describe("preview navigation failure forwarding", () => {
  it("forwards only aborted Open Design preview transport subframe navigations", () => {
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
      frameName: "od-artifact-preview-srcdoc",
      isMainFrame: false,
      occurredAtMs: 1235,
      validatedUrl: "blob:od://app/preview-document",
    })).toEqual({
      errorCode: -3,
      eventId: 2,
      frameName: "od-artifact-preview-srcdoc",
      occurredAtMs: 1235,
      validatedUrl: "blob:od://app/preview-document",
    });

    expect(previewNavigationFailureFromDidFailLoad({
      errorCode: -3,
      eventId: 3,
      isMainFrame: false,
      occurredAtMs: 1236,
      validatedUrl: "od://app/api/projects/project-1/raw/index.html?v=1&odPreviewEpoch=preview-document-2",
    })).toEqual({
      errorCode: -3,
      eventId: 3,
      occurredAtMs: 1236,
      validatedUrl: "od://app/api/projects/project-1/raw/index.html?v=1&odPreviewEpoch=preview-document-2",
    });

    expect(previewNavigationFailureFromDidFailLoad({
      errorCode: -3,
      eventId: 4,
      isMainFrame: true,
      occurredAtMs: 1237,
      validatedUrl: "about:srcdoc",
    })).toBeNull();
    expect(previewNavigationFailureFromDidFailLoad({
      errorCode: -6,
      eventId: 5,
      isMainFrame: false,
      occurredAtMs: 1238,
      validatedUrl: "about:srcdoc",
    })).toBeNull();
    expect(previewNavigationFailureFromDidFailLoad({
      errorCode: -3,
      eventId: 6,
      isMainFrame: false,
      occurredAtMs: 1239,
      validatedUrl: "https://example.com/",
    })).toBeNull();
    expect(previewNavigationFailureFromDidFailLoad({
      errorCode: -3,
      eventId: 7,
      isMainFrame: false,
      occurredAtMs: 1240,
      validatedUrl: "blob:https://example.com/preview-document",
    })).toBeNull();
    expect(previewNavigationFailureFromDidFailLoad({
      errorCode: -3,
      eventId: 8,
      isMainFrame: false,
      occurredAtMs: 1241,
      validatedUrl: "od://app/api/projects/project-1/raw/index.html?v=1",
    })).toBeNull();
  });
});
