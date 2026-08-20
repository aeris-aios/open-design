import {
  releaseChannelFromIdentity,
  releaseInstallIdentity,
} from "@open-design/release";
import { OPEN_DESIGN_RUNTIME_DEFAULTS } from "@open-design/contracts/runtime/sidecars";

export { releaseAppVersionArgs } from "./packaged-release-version.js";

export type PackagedWinInstallIdentity = {
  displayName: string;
  namespaceToken: string;
};

function sanitizeNamespace(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

export function resolvePackagedWinInstallIdentity(options: {
  namespace: string;
  releaseVersion: string | null | undefined;
}): PackagedWinInstallIdentity {
  const namespaceToken = sanitizeNamespace(options.namespace);
  const channel = releaseChannelFromIdentity(
    options.releaseVersion,
    options.namespace,
    OPEN_DESIGN_RUNTIME_DEFAULTS.namespace,
  );
  const displayName = channel == null ? `Open Design ${namespaceToken}` : releaseInstallIdentity(channel).productName;
  return { displayName, namespaceToken };
}
