import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

// Landing-page owns its copies of the Grok Build mark (this surface is
// certain-exempt, so gate-lane e2e tests must not read it). This suite anchors
// the marketing copies against the product copy in apps/web instead.
const LANDING_LOGO_PATH = new URL(
  "../public/agent-icons/grok-build.png",
  import.meta.url,
);
const PRODUCT_LOGO_PATH = new URL(
  "../../web/public/agent-icons/grok-build.png",
  import.meta.url,
);
const SOURCE_PATHS = [
  new URL("../app/page.tsx", import.meta.url),
  new URL("../app/_lib/pricing-content.ts", import.meta.url),
] as const;

describe("grok build logo parity", () => {
  it("ships the same byte-identical mark as the product surface", async () => {
    const [landing, product] = await Promise.all([
      readFile(LANDING_LOGO_PATH),
      readFile(PRODUCT_LOGO_PATH),
    ]);

    assert.equal(landing.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.deepEqual(landing, product);
  });

  it("does not route Grok or xAI surfaces back to the superseded X artwork", async () => {
    const sources = (
      await Promise.all(SOURCE_PATHS.map((url) => readFile(url, "utf8")))
    ).join("\n");

    assert.match(sources, /grok-build\.png/);
    assert.doesNotMatch(sources, /grok-build\.svg|agents\/xai\.svg/);
  });
});
