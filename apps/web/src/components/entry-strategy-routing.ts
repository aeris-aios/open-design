import {
  automaticStrategyTaskProfileForProjectMetadata,
  type ProjectMetadata,
  type ProjectScenarioTaskProfile,
} from '@open-design/contracts';

interface EntryStrategyRoutingInput {
  automaticStrategyTaskProfile?: ProjectScenarioTaskProfile | null;
  skillId?: string | null;
  pluginInputs?: Record<string, unknown> | null;
}

export type EntryStrategyRoutingFields = {
  skillId: string | null;
  automaticStrategyTaskProfile?: ProjectScenarioTaskProfile;
  pluginInputs?: Record<string, unknown>;
};

/**
 * Keep the Home-to-create handoff fail-closed: a claimed automatic route is
 * accepted only when the exact project metadata describes the same OD Next
 * task. Ordinary routes retain the existing Skill/plugin-input behavior.
 */
export function entryStrategyRoutingFields(
  input: EntryStrategyRoutingInput,
  metadata: ProjectMetadata,
): EntryStrategyRoutingFields {
  const automaticStrategyTaskProfile = input.automaticStrategyTaskProfile
    && input.automaticStrategyTaskProfile
      === automaticStrategyTaskProfileForProjectMetadata(metadata)
      ? input.automaticStrategyTaskProfile
      : null;
  if (automaticStrategyTaskProfile) {
    return {
      skillId: null,
      automaticStrategyTaskProfile,
    };
  }
  return {
    skillId: input.skillId ?? null,
    ...(input.pluginInputs ? { pluginInputs: input.pluginInputs } : {}),
  };
}
