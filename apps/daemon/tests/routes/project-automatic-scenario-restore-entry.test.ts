// The 「使用系统自动场景」 entry in the project header, judged at the daemon
// HTTP boundary: create every first-level output type on Home's create rail
// through the real `POST /api/projects`, then run the exact predicate
// `ProjectView` renders the Button on.
//
// Each card can reach the create in two shapes, and both must land on a
// project the header leaves alone:
//
//   - the card itself, which claims the product-owned automatic default and
//     names no plugin, so the daemon re-derives it and stamps
//     `automatic_default`;
//   - a pick made under the card — an example/preset card, a plugin card's
//     「使用」 — which pins the plugin it applied, so the daemon records
//     `explicit_user`.
//
// The second shape stays `explicit_user` on purpose: naming a plugin is how a
// caller opts a project out of OD Next, and softening that would let the
// rollout override authority it must not touch. What the header must not do is
// read that label as "this project left its automatic scenario" when the plugin
// it names IS the metadata's automatic default.

import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { projectLeftItsAutomaticScenario } from '@open-design/contracts';
import type { ProjectMetadata, ProjectScenarioTaskProfile } from '@open-design/contracts';
import { closeDatabase } from '../../src/db.js';
import { startServer, type StartServerOptions } from '../../src/server.js';

type StartedServer = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

type RailSurface = {
  chipId: string;
  metadata: Record<string, unknown>;
  /** The plugin the card applies, and the one a pick under it forwards. */
  scenarioPluginId: string;
  /** The chip's `action.inputs`, which ride along in both shapes. */
  pluginInputs?: Record<string, unknown>;
  /** Claimed by the three cards that own an OD Next route. */
  automaticStrategyTaskProfile?: ProjectScenarioTaskProfile;
};

const CREATE_RAIL_SURFACES: RailSurface[] = [
  {
    chipId: 'prototype',
    metadata: { kind: 'prototype' },
    scenarioPluginId: 'example-web-prototype',
    automaticStrategyTaskProfile: 'prototype',
  },
  {
    chipId: 'deck',
    metadata: { kind: 'deck' },
    scenarioPluginId: 'example-simple-deck',
    automaticStrategyTaskProfile: 'ppt',
  },
  {
    chipId: 'hyperframes',
    metadata: { kind: 'video', intent: 'hyperframes', videoModel: 'hyperframes-html' },
    scenarioPluginId: 'example-hyperframes',
    automaticStrategyTaskProfile: 'hyperframes',
  },
  // The media composer also stamps the picked model / prompt template on the
  // metadata; neither participates in scenario routing, so they are left out.
  {
    chipId: 'image',
    metadata: { kind: 'image' },
    scenarioPluginId: 'od-media-generation',
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
    scenarioPluginId: 'od-media-generation',
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
    scenarioPluginId: 'od-media-generation',
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
    scenarioPluginId: 'od-new-generation',
    pluginInputs: {
      artifactKind: 'document',
      audience: 'readers',
      topic: 'the user brief',
    },
  },
  {
    chipId: 'web-clone',
    metadata: { kind: 'prototype', intent: 'web-clone' },
    scenarioPluginId: 'example-web-clone',
  },
  {
    chipId: 'live-artifact',
    metadata: { kind: 'prototype', intent: 'live-artifact', fidelity: 'high-fidelity' },
    scenarioPluginId: 'example-live-artifact',
  },
  {
    chipId: 'webgl',
    metadata: { kind: 'prototype', intent: 'webgl-experience', fidelity: 'high-fidelity' },
    scenarioPluginId: 'example-webgl-experience',
  },
];

/**
 * The cards that own no OD Next route. Only these can reach the create with a
 * plugin pinned: on the other three an example pick travels as an
 * `exampleReference` and the automatic route survives.
 */
const PLUGIN_FORWARDING_SURFACES = CREATE_RAIL_SURFACES.filter(
  (surface) => !surface.automaticStrategyTaskProfile,
);

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

/** What the card itself sends: metadata and inputs, never a plugin id. */
function automaticDefaultBody(surface: RailSurface): Record<string, unknown> {
  return {
    metadata: surface.metadata,
    ...(surface.pluginInputs ? { pluginInputs: surface.pluginInputs } : {}),
    ...(surface.automaticStrategyTaskProfile
      ? { automaticStrategyTaskProfile: surface.automaticStrategyTaskProfile }
      : {}),
  };
}

/** What a pick made under the card sends: the plugin it just applied. */
function forwardedPluginBody(surface: RailSurface): Record<string, unknown> {
  return {
    metadata: surface.metadata,
    pluginId: surface.scenarioPluginId,
    ...(surface.pluginInputs ? { pluginInputs: surface.pluginInputs } : {}),
  };
}

/** The exact gate `ProjectView` renders the restore Button on. */
function showsRestoreAutomaticScenarioEntry(project: CreatedProject): boolean {
  return projectLeftItsAutomaticScenario({
    metadata: project.metadata,
    appliedPluginSnapshotId: project.appliedPluginSnapshotId,
  });
}

describe('automatic scenario restore entry', () => {
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

  it('is hidden for every first-level output type on the create rail', async () => {
    const { url } = await daemon();
    const shown: string[] = [];
    for (const surface of CREATE_RAIL_SURFACES) {
      const project = await createProject(url, surface.chipId, automaticDefaultBody(surface));
      if (showsRestoreAutomaticScenarioEntry(project)) shown.push(surface.chipId);
    }
    expect(shown).toEqual([]);
  });

  it('is hidden when a pick under the card forwards its scenario plugin', async () => {
    const { url } = await daemon();
    const shown: string[] = [];
    for (const surface of PLUGIN_FORWARDING_SURFACES) {
      const project = await createProject(
        url,
        `${surface.chipId}-pinned`,
        forwardedPluginBody(surface),
      );
      // The pin is recorded as user authority — that part is correct and the
      // rollout depends on it — and the header still leaves it alone.
      expect(project.metadata.scenarioBinding, surface.chipId).toMatchObject({
        provenance: 'explicit_user',
        pluginId: surface.scenarioPluginId,
        snapshotId: project.appliedPluginSnapshotId,
      });
      if (showsRestoreAutomaticScenarioEntry(project)) shown.push(surface.chipId);
    }
    expect(shown).toEqual([]);
  });

  // `routes/runs.ts` recomputes the same judgement per run
  // (`projectPinIsAutomaticDefault`), and a run that does not recognise the pin
  // as automatic stops re-stamping the binding onto the snapshot it links.
  it('stamps a binding the run path also reads as the automatic default', async () => {
    const { url } = await daemon();
    for (const surface of PLUGIN_FORWARDING_SURFACES) {
      const project = await createProject(url, surface.chipId, automaticDefaultBody(surface));
      expect(project.metadata.scenarioBinding, surface.chipId).toMatchObject({
        schemaVersion: 1,
        provenance: 'automatic_default',
        pluginId: surface.scenarioPluginId,
        snapshotId: project.appliedPluginSnapshotId,
      });
    }
  });

  // The other half of the contract: the entry is a real escape hatch, so a
  // project pinned to a scenario the automatic router would NOT choose keeps
  // offering it. Both shapes of "automatic" are covered — a plugin that is not
  // the metadata's default, and any plugin at all on metadata OD Next routes.
  it('is offered for a project pinned off its automatic scenario', async () => {
    const { url } = await daemon();
    const offDefault = await createProject(url, 'off-default', {
      metadata: { kind: 'image' },
      pluginId: 'od-new-generation',
      pluginInputs: { artifactKind: 'poster', audience: 'readers', topic: 'the user brief' },
    });
    expect(showsRestoreAutomaticScenarioEntry(offDefault)).toBe(true);

    const pinnedOffOdNext = await createProject(url, 'pinned-off-od-next', {
      metadata: { kind: 'prototype' },
      pluginId: 'example-web-prototype',
    });
    expect(pinnedOffOdNext.metadata.scenarioBinding).toMatchObject({
      provenance: 'explicit_user',
      pluginId: 'example-web-prototype',
    });
    expect(showsRestoreAutomaticScenarioEntry(pinnedOffOdNext)).toBe(true);
  });
});
