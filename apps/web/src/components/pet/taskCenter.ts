import type { ChatRunStatusResponse } from '@open-design/contracts';
import type { Project } from '../../types';
import type { PetRecentTaskSummary, PetTaskCenter, PetTaskSummary } from './PetOverlay';
import {
  isTerminalRunStatus,
  terminalRunDisplayStatus,
} from '../../state/projectRunStatus';

export function buildPetTaskCenter(
  projects: Project[],
  runs: ChatRunStatusResponse[],
): PetTaskCenter {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const running = new Map<string, PetTaskSummary>();
  const queued = new Map<string, PetTaskSummary>();
  const recentByProject = new Map<string, PetRecentTaskSummary>();

  for (const run of runs) {
    if (!run.projectId) continue;
    const project = projectsById.get(run.projectId);
    if (!project) continue;
    if (run.status === 'running') {
      addActiveSummary(running, run.projectId, project.name, 'running');
      continue;
    }
    if (run.status === 'queued') {
      addActiveSummary(queued, run.projectId, project.name, 'queued');
      continue;
    }
    if (isTerminalRunStatus(run.status)) {
      const prev = recentByProject.get(run.projectId);
      if (prev && prev.updatedAt >= run.updatedAt) continue;
      // Shared with the tab-dropdown indicator so both surfaces agree on what
      // "finished" means — in particular that a `succeeded` run with unfinished
      // declared work is `incomplete`, never the success colour (#1247 / #1060).
      const status: PetRecentTaskSummary['status'] = terminalRunDisplayStatus(run);
      recentByProject.set(run.projectId, {
        projectId: run.projectId,
        projectName: project.name,
        status,
        updatedAt: run.updatedAt,
      });
    }
  }

  return {
    running: sortActiveSummaries([...running.values()]),
    queued: sortActiveSummaries([...queued.values()]),
    recent: [...recentByProject.values()]
      .filter((task) => !running.has(task.projectId) && !queued.has(task.projectId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3),
  };
}

function addActiveSummary(
  summaries: Map<string, PetTaskSummary>,
  projectId: string,
  projectName: string,
  status: PetTaskSummary['status'],
) {
  const prev = summaries.get(projectId);
  summaries.set(projectId, {
    projectId,
    projectName,
    status,
    count: (prev?.count ?? 0) + 1,
  });
}

function sortActiveSummaries(summaries: PetTaskSummary[]): PetTaskSummary[] {
  return summaries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.projectName.localeCompare(b.projectName);
  });
}
