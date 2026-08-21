import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("packaged desktop sidecar boundary", () => {
  it("turns desktop auth transport failures into a false registration result", () => {
    const main = readFileSync(join(here, "../src/index.ts"), "utf8");
    const registrationStart = main.indexOf("registerDesktopAuth: async (secret) => {");
    const registrationEnd = main.indexOf("windowTitle:", registrationStart);
    expect(registrationStart).toBeGreaterThanOrEqual(0);
    expect(registrationEnd).toBeGreaterThan(registrationStart);
    const registration = main.slice(registrationStart, registrationEnd);
    expect(registration).toContain("try {");
    expect(registration).toContain("catch {\n        return false;");
  });
});
