import type { RunTelemetryTimestamps } from './run-analytics-observability.js';
import type { TrackingFirstModelEventType } from '@open-design/contracts/analytics';

export type RunLifecycleMark =
  | 'start_requested'
  | 'chat_run_started'
  | 'prompt_build_start'
  | 'prompt_build_end'
  | 'launch_preflight_start'
  | 'launch_preflight_end'
  | 'process_spawn_start'
  | 'process_spawned'
  | 'model_call_start'
  | 'stdin_write_start'
  | 'stdin_write_end'
  | 'first_model_event'
  | 'first_token'
  | 'first_visible_output'
  | 'first_artifact_write'
  | 'finalize_start';

const MARK_TO_FIELD: Record<RunLifecycleMark, keyof RunTelemetryTimestamps> = {
  start_requested: 'startRequestedAt',
  chat_run_started: 'startChatRunStartedAt',
  prompt_build_start: 'promptBuildStartAt',
  prompt_build_end: 'promptBuildEndAt',
  launch_preflight_start: 'launchPreflightStartAt',
  launch_preflight_end: 'launchPreflightEndAt',
  process_spawn_start: 'processSpawnStartedAt',
  process_spawned: 'processSpawnedAt',
  model_call_start: 'modelCallStartAt',
  stdin_write_start: 'stdinWriteStartAt',
  stdin_write_end: 'stdinWriteEndAt',
  first_model_event: 'firstModelEventAt',
  first_token: 'firstTokenAt',
  first_visible_output: 'firstVisibleOutputAt',
  first_artifact_write: 'firstArtifactWriteAt',
  finalize_start: 'finalizeStartAt',
};

export interface RunWithLifecycleTelemetry {
  analyticsTelemetry?: RunTelemetryTimestamps | null;
}

export interface RunLifecycleStreamEventMarkers {
  firstModelEventType?: TrackingFirstModelEventType;
  firstVisibleOutput: boolean;
  firstArtifactWrite: boolean;
}

/**
 * Whether a streamed delta frame actually put characters on the user's screen.
 *
 * `text_delta` / `thinking_delta` frames are not self-evidently visible: Claude
 * Code streams `thinking_delta` whose `thinking` is the empty string, carrying
 * only an `estimated_tokens` count (measured off the CLI directly: 20 of 20
 * frames on a 26.5s extended-thinking turn, and 1508 of 1707 across the 32
 * runs recorded in `claude-stream.ts`). Those frames arrive, and the daemon
 * forwards them, but they render nothing.
 *
 * `first_visible_output` is the boundary that answers "when did the user stop
 * staring at an empty message?", so it must be stamped by pixels, not by frame
 * arrival. Frame arrival is already covered by `first_model_event`.
 */
function deltaCarriesCharacters(data: unknown): boolean {
  const delta =
    data && typeof data === 'object' && 'delta' in data
      ? (data as { delta?: unknown }).delta
      : undefined;
  return typeof delta === 'string' && delta.length > 0;
}

export function runLifecycleMarkersForStreamEvent(
  event: string,
  data: unknown,
): RunLifecycleStreamEventMarkers {
  const type =
    data && typeof data === 'object' && 'type' in data
      ? (data as { type?: unknown }).type
      : undefined;
  if (event === 'agent') {
    const firstModelEventType =
      type === 'text_delta' ||
      type === 'thinking_delta' ||
      type === 'tool_use' ||
      type === 'artifact'
        ? type
        : undefined;
    return {
      ...(firstModelEventType ? { firstModelEventType } : {}),
      firstVisibleOutput:
        type === 'artifact' ||
        ((type === 'text_delta' || type === 'thinking_delta') &&
          deltaCarriesCharacters(data)),
      firstArtifactWrite: type === 'artifact' || type === 'live_artifact',
    };
  }
  return {
    firstVisibleOutput: false,
    firstArtifactWrite: event === 'live_artifact',
  };
}

export function createRunLifecycleTracer(run: RunWithLifecycleTelemetry): {
  mark(mark: RunLifecycleMark, timestamp?: number): void;
  markFirstModelEvent(type: TrackingFirstModelEventType, timestamp?: number): void;
  resetForAttempt(attemptIndex: number, timestamp?: number): void;
} {
  const mark = (lifecycleMark: RunLifecycleMark, timestamp = Date.now()) => {
    const field = MARK_TO_FIELD[lifecycleMark];
    const current = run.analyticsTelemetry ?? {};
    if (current[field] !== undefined) return;
    run.analyticsTelemetry = {
      ...current,
      [field]: timestamp,
    };
  };

  return {
    mark,
    markFirstModelEvent(type: TrackingFirstModelEventType, timestamp = Date.now()) {
      const current = run.analyticsTelemetry ?? {};
      if (current.firstModelEventAt !== undefined) return;
      run.analyticsTelemetry = {
        ...current,
        firstModelEventAt: timestamp,
        firstModelEventType: type,
      };
    },
    resetForAttempt(attemptIndex: number, timestamp = Date.now()) {
      run.analyticsTelemetry = {
        attemptIndex,
        attemptStartedAt: timestamp,
        ...(run.analyticsTelemetry?.startRequestedAt !== undefined
          ? { startRequestedAt: run.analyticsTelemetry.startRequestedAt }
          : {}),
      };
    },
  };
}
