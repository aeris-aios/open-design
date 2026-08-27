// Reproduction for the "use the system automatic scenario" entry appearing on
// projects that never left their automatic scenario.
//
// `ProjectView` renders that Button when `hasCurrentAutomaticScenarioBinding()`
// is false, which needs a `scenarioBinding` stamped `automatic_default` — and
// only `POST /api/projects` stamps one, via `automaticDefaultRouting`, which is
// false as soon as the body names a `pluginId` or `appliedPluginSnapshotId`.
//
// Naming a plugin is deliberately real authority here: it is how a caller opts
// a project out of OD Next (see "never overrides explicit plugin, snapshot, or
// existing project-pin authority" in od-next-automatic-simple-server). So the
// create rail must not name one. Home's first-level task chips send
// `pluginSelectionProvenance: 'automatic-default'` instead, and `EntryShell`
// then omits the plugin fields — but seven of the ten chips were missing
// `automaticDefault`, forwarded their plugin id, and produced projects with no
// automatic binding at all.

import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { hasCurrentAutomaticScenarioBinding } from '@open-design/contracts';
import type { ProjectMetadata, ProjectScenarioTaskProfile } from '@open-design/contracts';
import { closeDatabase } from '../src/db.js';
import { startServer, type StartServerOptions } from '../src/server.js';

type StartedServer = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

type Surface = {
  chipId: string;
  metadata: Record<string, unknown>;
  /** The chip's `action.inputs`, which ride along on an automatic create. */
  pluginInputs?: Record<string, unknown>;
  /** Claimed by the three chips that own an OD Next route. */
  automaticStrategyTaskProfile?: ProjectScenarioTaskProfile;
  /** Expected `scenarioBinding.pluginId`; absent on the OD Next routes, which
   *  carry a `strategyBinding` and no applied snapshot instead. */
  expectedScenarioPluginId?: string;
};

// Every entry in `CREATE_RAIL_ORDER`, carrying what `EntryShell` sends once the
// chip claims the automatic default: metadata and inputs, never a plugin id.
const CREATE_RAIL_SURFACES: Surface[] = [
  { chipId: 'prototype', metadata: { kind: 'prototype' }, automaticStrategyTaskProfile: 'prototype' },
  { chipId: 'deck',      metadata: { kind: 'deck' },      automaticStrategyTaskProfile: 'ppt' },
  {
    chipId: 'hyperframes',
    metadata: { kind: 'video', intent: 'hyperframes', videoModel: 'hyperframes-html' },
    automaticStrategyTaskProfile: 'hyperframes',
  },
  {
    chipId: 'image',
    metadata: { kind: 'image' },
    expectedScenarioPluginId: 'od-media-generation',
    pluginInputs: {
      mediaKind: 'image',
      subject: 'a polished product concept',
      style: 'cinematic, high-quality, on-brand',
      aspect: '16:9',
    },
  },
  {
    chipId: 'video',
    metadata: { kind: 'video' },
    expectedScenarioPluginId: 'od-media-generation',
    pluginInputs: {
      mediaKind: 'video',
      subject: 'a short product reveal',
      style: 'cinematic, high-quality, on-brand',
      aspect: '16:9',
    },
  },
  {
    chipId: 'audio',
    metadata: { kind: 'audio' },
    expectedScenarioPluginId: 'od-media-generation',
    pluginInputs: {
      mediaKind: 'audio',
      subject: 'a concise audio identity for a product',
      style: 'clear, polished, modern',
      aspect: '16:9',
    },
  },
  {
    chipId: 'document',
    metadata: { kind: 'other', intent: 'document' },
    expectedScenarioPluginId: 'od-new-generation',
    pluginInputs: {
      artifactKind: 'document',
      audience: 'readers',
      topic: 'the user brief',
    },
  },
  {
    chipId: 'web-clone',
    metadata: { kind: 'prototype', intent: 'web-clone' },
    expectedScenarioPluginId: 'example-web-clone',
  },
  {
    chipId: 'live-artifact',
    metadata: { kind: 'prototype', intent: 'live-artifact', fidelity: 'high-fidelity' },
    expectedScenarioPluginId: 'example-live-artifact',
  },
  {
    chipId: 'webgl',
    metadata: { kind: 'prototype', intent: 'webgl-experience', fidelity: 'high-fidelity' },
    expectedScenarioPluginId: 'example-webgl-experience',
  },
];

type CreatedProject = {
  appliedPluginSnapshotId: string | null;
  metadata: ProjectMetadata;
};

async function createProject(
  url: string,
  label: string,
  body: Record<string, unknown>,
): Promise<CreatedProject> {
  const response = await fetch(`${url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: `restore-entry-${label}-${process.hrtime.bigint()}`,
      name: `restore entry ${label}`,
      conversationMode: 'design',
      skipDiscoveryBrief: true,
      ...body,
    }),
  });
  if (response.status !== 200) {
    throw new Error(`${label} create -> ${response.status}: ${await response.text()}`);
  }
  const parsed = await response.json() as {
    appliedPluginSnapshotId?: string | null;
    project?: { metadata?: ProjectMetadata; appliedPluginSnapshotId?: string | null };
  };
  return {
    appliedPluginSnapshotId:
      parsed.project?.appliedPluginSnapshotId ?? parsed.appliedPluginSnapshotId ?? null,
    metadata: (parsed.project?.metadata ?? {}) as ProjectMetadata,
  };
}

function createRailBody(surface: Surface): Record<string, unknown> {
  return {
    metadata: surface.metadata,
    ...(surface.pluginInputs ? { pluginInputs: surface.pluginInputs } : {}),
    ...(surface.automaticStrategyTaskProfile
      ? { automaticStrategyTaskProfile: surface.automaticStrategyTaskProfile }
      : {}),
  };
}

/** The exact gate `ProjectView` uses to render the restore Button. */
function showsRestoreAutomaticScenarioEntry(project: CreatedProject): boolean {
  return Boolean(
    project.metadata?.kind
    && !hasCurrentAutomaticScenarioBinding({
      metadata: project.metadata,
      appliedPluginSnapshotId: project.appliedPluginSnapshotId,
    }),
  );
}

describe('automatic scenario restore entry on freshly created projects', () => {
  let started: StartedServer | null = null;

  async function daemon(): Promise<StartedServer> {
    started = await startServer(
      { port: 0, returnServer: true } as StartServerOptions,
    ) as StartedServer;
    return started;
  }

  afterEach(async () => {
    if (started) {
      await Promise.resolve(started.shutdown?.());
      if (started.server.listening) {
        await new Promise<void>((resolve) => started!.server.close(() => resolve()));
      }
    }
    started = null;
    closeDatabase();
  });

  it('hides the entry for every first-level output type on the create rail', async () => {
    const { url } = await daemon();
    const shown: string[] = [];
    for (const surface of CREATE_RAIL_SURFACES) {
      const project = await createProject(url, surface.chipId, createRailBody(surface));
      if (showsRestoreAutomaticScenarioEntry(project)) shown.push(surface.chipId);
    }
    expect(shown).toEqual([]);
  });

  // `routes/runs.ts` recomputes the same judgement per run
  // (`projectPinIsAutomaticDefault`), and a run that does not recognise the pin
  // as automatic stops re-stamping the binding onto the snapshot it links.
  it('stamps a binding the run path also reads as the automatic default', async () => {
    const { url } = await daemon();
    for (const surface of CREATE_RAIL_SURFACES) {
      if (!surface.expectedScenarioPluginId) continue;
      const project = await createProject(url, surface.chipId, createRailBody(surface));
      expect(project.metadata.scenarioBinding, surface.chipId).toMatchObject({
        schemaVersion: 1,
        provenance: 'automatic_default',
        pluginId: surface.expectedScenarioPluginId,
        snapshotId: project.appliedPluginSnapshotId,
      });
    }
  });

  // The other half of the contract, and why this defect is fixed on the create
  // rail rather than by softening `automaticDefaultRouting`: a body that names
  // a plugin is user authority even when it names the metadata's own default,
  // because that is how a caller opts a project out of OD Next. Such a project
  // has genuinely left automatic routing, so the entry belongs there.
  it('keeps a named plugin explicit — and keeps offering the entry for it', async () => {
    const { url } = await daemon();
    const pinned = await createProject(url, 'named-default', {
      metadata: { kind: 'prototype' },
      pluginId: 'example-web-prototype',
    });
    expect(pinned.metadata.scenarioBinding).toMatchObject({
      provenance: 'explicit_user',
      pluginId: 'example-web-prototype',
    });
    expect(showsRestoreAutomaticScenarioEntry(pinned)).toBe(true);
  });
});
