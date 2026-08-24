import { writeFileSync } from "node:fs";

process.title = "next-server";

const readyPath = process.env.OD_TEST_SIDECAR_READY;
if (readyPath != null) writeFileSync(readyPath, JSON.stringify({
  generationPid: Number(process.env.OD_SIDECAR_GENERATION_PID),
  runtimePid: process.pid,
}));

process.on("SIGTERM", () => {
  // Exercise the managed generation's force-stop fallback.
});

setInterval(() => undefined, 60_000);
