import { collectProcessTreePids, readProcessStampFromCommand, type ProcessSnapshot } from "@open-design/platform";

import { sidecarStampKey, SIDECAR_STAMP_CONTRACT, type SidecarStamp } from "./stamp.js";

/**
 * Collect one sidecar generation without crossing into a descendant resource.
 *
 * The generation owns ordinary descendants, including targets whose visible
 * argv is later rewritten. A descendant carrying a different complete
 * five-field stamp is another sidecar resource root and owns its own subtree.
 */
export function collectSidecarGenerationPids(
  processes: ProcessSnapshot[],
  rootPids: Array<number | null | undefined>,
  stampInput: SidecarStamp,
): number[] {
  const stampKey = sidecarStampKey(stampInput);
  const roots = new Set(rootPids.filter((pid): pid is number => typeof pid === "number"));
  const ownedProcesses = processes.filter((processInfo) => {
    if (roots.has(processInfo.pid)) return true;
    const nestedStamp = readProcessStampFromCommand(processInfo.command, SIDECAR_STAMP_CONTRACT);
    return nestedStamp == null || sidecarStampKey(nestedStamp) === stampKey;
  });
  return collectProcessTreePids(ownedProcesses, [...roots]);
}
