import {
  DAEMON_SIDECAR_INPUTS,
  createOpenDesignRuntimeContext,
  type DaemonSidecarMethods,
} from "@open-design/contracts/runtime/sidecars";
import {
  attachSidecar,
  resumeControlPlane,
  type SidecarControlPlane,
} from "@open-design/sidecar/control";

import { startDaemonSidecar, type DaemonSidecarHandle } from "./server.js";
import {
  executeLegacyPayloadDesktopHandoff,
  prepareLegacyPayloadDesktopHandoff,
  type LegacyPayloadDesktopHandoffPreparation,
} from "./payload-desktop-handoff.js";

async function main(): Promise<void> {
  let server: DaemonSidecarHandle | null = null;
  let control: SidecarControlPlane | null = null;
  let desktopHandoff: LegacyPayloadDesktopHandoffPreparation | null = null;
  const attached = await attachSidecar<DaemonSidecarMethods>({
    handlers: {
      mintImportToken(input) {
        return server!.mintImportToken(DAEMON_SIDECAR_INPUTS.mintImportToken.parse(input).baseDir);
      },
      registerDesktopAuth(input) {
        return server!.registerDesktopAuth(DAEMON_SIDECAR_INPUTS.registerDesktopAuth.parse(input));
      },
      registerWebUrl(input) {
        return server!.registerWebUrl(DAEMON_SIDECAR_INPUTS.registerWebUrl.parse(input));
      },
      async status(input) {
        DAEMON_SIDECAR_INPUTS.status.parse(input);
        return await server!.status();
      },
    },
    lifecycle: {
      async initialize(context) {
        const runtime = createOpenDesignRuntimeContext(context);
        desktopHandoff = await prepareLegacyPayloadDesktopHandoff({
          namespace: runtime.namespace,
          runtimeRoot: runtime.runtimeRoot,
          source: runtime.source,
        }).catch((error: unknown) => {
          console.warn("[packaged desktop handoff] prepare failed", error);
          return null;
        });
        control = resumeControlPlane(context);
        server = await startDaemonSidecar(runtime, control);
      },
      async stop() {
        await server?.stop();
        await server?.waitUntilStopped();
      },
    },
  });

  try {
    process.stdout.write(`${JSON.stringify(await server!.status(), null, 2)}\n`);
    const handoff = desktopHandoff as LegacyPayloadDesktopHandoffPreparation | null;
    if (handoff?.kind === "none") {
      console.info("[packaged desktop handoff] skipped", { reason: handoff.reason });
    }
    if (handoff?.kind === "prepared") {
      void executeLegacyPayloadDesktopHandoff(handoff, { control: control! })
        .then((result) => console.info("[packaged desktop handoff]", result))
        .catch((error: unknown) => console.warn("[packaged desktop handoff] execute failed", error));
    }
    await server!.waitUntilStopped();
  } finally {
    await attached.close();
  }
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  },
);
