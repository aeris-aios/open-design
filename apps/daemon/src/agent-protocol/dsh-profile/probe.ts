/** @module agent-protocol/dsh-profile/probe */
import { parseDshProfileRuntimeFrame } from './frames.js';
import type { DshProfileProbeFrame } from './types.js';

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
