/** @module agent-protocol/dsh-profile/probe */
import { parseDshProfileRuntimeFrame } from './frames.js';
import type {
  DshProfileModelCatalogEntry,
  DshProfileProbeFrame,
} from './types.js';

export function parseDshProfileProbeOutput(stdout: string): DshProfileProbeFrame {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length !== 1) {
    throw new Error('DeepSeek Harness profile probe must emit exactly one frame.');
  }
  let value: unknown;
  try {
    value = JSON.parse(lines[0] ?? '') as unknown;
  } catch {
    throw new Error('DeepSeek Harness profile probe emitted malformed JSON.');
  }
  const frame = parseDshProfileRuntimeFrame(value);
  if (frame.type !== 'probe') {
    throw new Error('DeepSeek Harness profile probe emitted the wrong frame type.');
  }
  return frame;
}

export function parseDshProfileModelsOutput(stdout: string): DshProfileModelCatalogEntry[] | null {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length !== 1) return null;
  let value: unknown;
  try {
    value = JSON.parse(lines[0] ?? '') as unknown;
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const frame = value as Record<string, unknown>;
  if (
    frame.v !== 1 ||
    frame.type !== 'models' ||
    frame.runtime !== 'open-design' ||
    !Array.isArray(frame.models)
  ) return null;

  const models: DshProfileModelCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of frame.models) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const model = candidate as Record<string, unknown>;
    if (
      typeof model.provider !== 'string' || model.provider.length === 0 ||
      typeof model.provider_name !== 'string' || model.provider_name.length === 0 ||
      typeof model.id !== 'string' || model.id.length === 0 ||
      typeof model.name !== 'string' || model.name.length === 0
    ) return null;
    const id = `${model.provider}/${model.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({
      provider: model.provider,
      provider_name: model.provider_name,
      id: model.id,
      name: model.name,
    });
  }
  return models.length > 0 ? models : null;
}
