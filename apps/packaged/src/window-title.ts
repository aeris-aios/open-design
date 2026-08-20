import {
  releaseChannelFromIdentity,
  releaseInstallIdentity,
} from "@open-design/release";
import { OPEN_DESIGN_RUNTIME_DEFAULTS } from "@open-design/contracts/runtime/sidecars";

const DEFAULT_WINDOW_TITLE = "Open Design";

export function resolvePackagedWindowTitle(config: { appVersion: string | null; namespace: string }): string {
  const channel = releaseChannelFromIdentity(
    config.appVersion,
    config.namespace,
    OPEN_DESIGN_RUNTIME_DEFAULTS.namespace,
  );
  return channel == null ? DEFAULT_WINDOW_TITLE : releaseInstallIdentity(channel).productName;
}
