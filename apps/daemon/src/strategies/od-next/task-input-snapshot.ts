import {
  OD_NEXT_REQUEST_INPUT_FACTS_SCHEMA_V1,
  OD_NEXT_TASK_CONFIGURATION_SCHEMA_V1,
  serializeOdNextRequestInputFactsV1,
  serializeOdNextTaskConfigurationV1,
  type MediaExecutionPolicy,
  type OdNextAttachmentFactV1,
  type OdNextProductionTaskTypeV1,
  type OdNextRequestInputFactsV1,
  type OdNextTaskConfigurationV1,
} from '@open-design/contracts';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { redactSecrets } from '../../redact.js';

const SNAPSHOT_SCHEMA = 'open-design.od-next-task-input-snapshot/v1' as const;
export const DEFAULT_OD_NEXT_ATTACHMENT_FILE_CAP_BYTES = 16 * 1024 * 1024;
export const DEFAULT_OD_NEXT_ATTACHMENT_TOTAL_CAP_BYTES = 32 * 1024 * 1024;
export const DEFAULT_OD_NEXT_ATTACHMENT_COUNT_CAP = 32;

export class OdNextTaskInputSnapshotError extends Error {
  constructor(message: string, readonly code = 'OD_NEXT_INPUT_SNAPSHOT_INVALID') {
    super(message);
    this.name = 'OdNextTaskInputSnapshotError';
  }
}

export interface OdNextTaskInputSnapshotDescriptor {
  taskExecutionId: string;
  snapshotDir: string;
  manifestSha256: string;
}

type SnapshotSource = {
  kind: 'file' | 'image';
  sourcePath: string;
  allowedRoot: string;
};

type SnapshotFile = {
  id: string;
  relativePath: string;
  kind: 'file' | 'image';
  mediaType: string;
  bytes: number;
  sha256: string;
};

type SnapshotManifest = {
  schema: typeof SNAPSHOT_SCHEMA;
  taskExecutionId: string;
  taskConfiguration: OdNextTaskConfigurationV1;
  requestInputFacts: OdNextRequestInputFactsV1;
  files: SnapshotFile[];
};

export interface LoadedOdNextTaskInputSnapshot {
  taskConfigText: string;
  requestInputText: string;
  attachmentReferences: string[];
  attachmentPaths: string[];
  imagePaths: string[];
  snapshotDir: string;
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
  );
}

function safeTaskId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new OdNextTaskInputSnapshotError('OD Next task execution id is not a safe path segment.');
  }
  return value;
}

function mediaTypeFromBytes(bytes: Buffer): { mediaType: string; extension: string } {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mediaType: 'image/png', extension: '.png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mediaType: 'image/jpeg', extension: '.jpg' };
  }
  if (bytes.length >= 6 && /GIF8[79]a/.test(bytes.toString('ascii', 0, 6))) {
    return { mediaType: 'image/gif', extension: '.gif' };
  }
  if (
    bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mediaType: 'image/webp', extension: '.webp' };
  }
  if (bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-') {
    return { mediaType: 'application/pdf', extension: '.pdf' };
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2] ?? -1)) {
    return { mediaType: 'application/zip', extension: '.zip' };
  }
  const decoded = bytes.toString('utf8');
  if (!decoded.includes('\uFFFD') && Buffer.from(decoded).equals(bytes)) {
    const head = decoded.trimStart().toLowerCase();
    if (head.startsWith('<svg')) return { mediaType: 'image/svg+xml', extension: '.svg' };
    if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
      return { mediaType: 'text/html', extension: '.html' };
    }
    if (head.startsWith('{') || head.startsWith('[')) {
      try {
        JSON.parse(decoded);
        return { mediaType: 'application/json', extension: '.json' };
      } catch {
        // Valid UTF-8, but not valid JSON: keep the generic text identity.
      }
    }
    return { mediaType: 'text/plain', extension: '.txt' };
  }
  return { mediaType: 'application/octet-stream', extension: '.bin' };
}

function readSourceWithoutFollowingSymlinks(
  source: SnapshotSource,
  maxBytes: number,
  afterReadSource?: (sourcePath: string) => void,
): Buffer {
  const declaredRoot = path.resolve(source.allowedRoot);
  const resolved = path.resolve(declaredRoot, source.sourcePath);
  if (!within(declaredRoot, resolved)) {
    throw new OdNextTaskInputSnapshotError('OD Next attachment escapes its allowed root.');
  }
  const linkStat = fs.lstatSync(resolved);
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
    throw new OdNextTaskInputSnapshotError('OD Next attachments must be regular non-symlink files.');
  }
  const root = fs.realpathSync(declaredRoot);
  const real = fs.realpathSync(resolved);
  if (!within(root, real)) {
    throw new OdNextTaskInputSnapshotError('OD Next attachment realpath escapes its allowed root.');
  }
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const fd = fs.openSync(real, fs.constants.O_RDONLY | noFollow);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile()) {
      throw new OdNextTaskInputSnapshotError('OD Next attachment is not a regular file.');
    }
    if (before.size > BigInt(maxBytes)) {
      throw new OdNextTaskInputSnapshotError('OD Next attachment exceeds the per-file byte cap.', 'OD_NEXT_INPUT_SNAPSHOT_OVERSIZE');
    }
    const bytes = fs.readFileSync(fd);
    afterReadSource?.(real);
    const after = fs.fstatSync(fd, { bigint: true });
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs
      || BigInt(bytes.length) !== after.size
    ) {
      throw new OdNextTaskInputSnapshotError('OD Next attachment changed while it was being frozen.', 'OD_NEXT_INPUT_SNAPSHOT_TOCTOU');
    }
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function normalizeLocale(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'und';
  try {
    return new Intl.Locale(value.trim().replaceAll('_', '-')).toString();
  } catch {
    return 'und';
  }
}

function safeOptionalConfig(value: unknown, field: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return undefined;
  }
  if (redactSecrets(normalized) !== normalized) {
    throw new OdNextTaskInputSnapshotError(
      `OD Next ${field} contains secret or credential-shaped content.`,
    );
  }
  return normalized;
}

export function buildOdNextTaskConfigurationV1(input: {
  taskType: OdNextProductionTaskTypeV1;
  locale?: unknown;
  selectedAgentId: string;
  sessionMode?: unknown;
  model?: unknown;
  reasoning?: unknown;
  serviceTier?: unknown;
  mediaExecution: MediaExecutionPolicy;
  route?: 'direct_edit' | 'full_plan';
  mode?: 'simple' | 'complex' | 'unresolved';
}): OdNextTaskConfigurationV1 {
  const selectedAgentId = safeOptionalConfig(input.selectedAgentId, 'selected agent id');
  if (!selectedAgentId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(selectedAgentId)) {
    throw new OdNextTaskInputSnapshotError('OD Next selected agent id is invalid.');
  }
  const sessionMode = input.sessionMode === 'chat' || input.sessionMode === 'plan'
    ? input.sessionMode
    : 'design';
  const allowedSurfaces = input.mediaExecution.allowedSurfaces
    ? [...new Set(input.mediaExecution.allowedSurfaces)].sort()
    : undefined;
  const allowedModels = input.mediaExecution.allowedModels
    ? [...new Set(input.mediaExecution.allowedModels
        .map((value) => safeOptionalConfig(value, 'media allowed model'))
        .filter((value): value is string => Boolean(value)))].sort()
    : undefined;
  const model = safeOptionalConfig(input.model, 'model selection');
  const reasoning = safeOptionalConfig(input.reasoning, 'reasoning selection');
  const serviceTier = safeOptionalConfig(input.serviceTier, 'service tier selection');
  return {
    schema: OD_NEXT_TASK_CONFIGURATION_SCHEMA_V1,
    taskType: input.taskType,
    locale: normalizeLocale(input.locale),
    selectedAgentId,
    route: input.route ?? 'full_plan',
    mode: input.mode ?? 'unresolved',
    configuration: {
      sessionMode,
      ...(model ? { model } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(serviceTier ? { serviceTier } : {}),
      mediaExecution: {
        mode: input.mediaExecution.mode,
        ...(allowedSurfaces ? { allowedSurfaces } : {}),
        ...(allowedModels ? { allowedModels } : {}),
      },
    },
  };
}

export function createOdNextTaskInputSnapshot(input: {
  snapshotsRoot: string;
  taskExecutionId: string;
  taskConfiguration: OdNextTaskConfigurationV1;
  projectRoot: string;
  projectAttachments?: readonly string[];
  uploadRoot: string;
  imagePaths?: readonly string[];
  commentCount?: number;
  linkedDirectoryCount?: number;
  mcpServerCount?: number;
  fileCapBytes?: number;
  totalCapBytes?: number;
  countCap?: number;
  afterReadSource?: (sourcePath: string) => void;
}): OdNextTaskInputSnapshotDescriptor {
  const taskExecutionId = safeTaskId(input.taskExecutionId);
  const sources: SnapshotSource[] = [
    ...(input.projectAttachments ?? []).map((sourcePath) => ({
      kind: 'file' as const,
      sourcePath,
      allowedRoot: input.projectRoot,
    })),
    ...(input.imagePaths ?? []).map((sourcePath) => ({
      kind: 'image' as const,
      sourcePath,
      allowedRoot: input.uploadRoot,
    })),
  ];
  const countCap = input.countCap ?? DEFAULT_OD_NEXT_ATTACHMENT_COUNT_CAP;
  if (sources.length > countCap) {
    throw new OdNextTaskInputSnapshotError('OD Next attachment count exceeds the task cap.', 'OD_NEXT_INPUT_SNAPSHOT_OVERSIZE');
  }
  const snapshotsRoot = path.resolve(input.snapshotsRoot);
  fs.mkdirSync(snapshotsRoot, { recursive: true, mode: 0o700 });
  const snapshotDir = path.join(snapshotsRoot, taskExecutionId);
  fs.mkdirSync(snapshotDir, { recursive: false, mode: 0o700 });
  const attachmentsDir = path.join(snapshotDir, 'attachments');
  fs.mkdirSync(attachmentsDir, { mode: 0o700 });
  const fileCap = input.fileCapBytes ?? DEFAULT_OD_NEXT_ATTACHMENT_FILE_CAP_BYTES;
  const totalCap = input.totalCapBytes ?? DEFAULT_OD_NEXT_ATTACHMENT_TOTAL_CAP_BYTES;
  const files: SnapshotFile[] = [];
  const facts: OdNextAttachmentFactV1[] = [];
  let total = 0;
  try {
    sources.forEach((source, index) => {
      let bytes: Buffer;
      try {
        bytes = readSourceWithoutFollowingSymlinks(
          source,
          fileCap,
          input.afterReadSource,
        );
      } catch (error) {
        if (error instanceof OdNextTaskInputSnapshotError) throw error;
        throw new OdNextTaskInputSnapshotError(
          'OD Next attachment could not be read and frozen safely.',
        );
      }
      total += bytes.length;
      if (total > totalCap) {
        throw new OdNextTaskInputSnapshotError('OD Next attachments exceed the task byte cap.', 'OD_NEXT_INPUT_SNAPSHOT_OVERSIZE');
      }
      const identity = sha256(bytes);
      const type = mediaTypeFromBytes(bytes);
      if (source.kind === 'image' && !type.mediaType.startsWith('image/')) {
        throw new OdNextTaskInputSnapshotError('OD Next image attachment bytes are not a supported image type.', 'OD_NEXT_INPUT_SNAPSHOT_TYPE_MISMATCH');
      }
      const id = `attachment-${String(index + 1).padStart(3, '0')}`;
      const relativePath = `attachments/${id}${type.extension}`;
      const destination = path.join(snapshotDir, relativePath);
      const fd = fs.openSync(destination, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o400);
      try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      const frozen = fs.readFileSync(destination);
      if (frozen.length !== bytes.length || sha256(frozen) !== identity) {
        throw new OdNextTaskInputSnapshotError('OD Next frozen attachment failed digest verification.');
      }
      files.push({
        id,
        relativePath,
        kind: source.kind,
        mediaType: type.mediaType,
        bytes: frozen.length,
        sha256: identity,
      });
      facts.push({
        id,
        order: index + 1,
        kind: source.kind,
        reference: `task-input:${relativePath}`,
        mediaType: type.mediaType,
        bytes: frozen.length,
        sha256: identity,
      });
    });
    const linkedDirectoryCount = Math.max(0, Math.floor(input.linkedDirectoryCount ?? 0));
    const requestInputFacts: OdNextRequestInputFactsV1 = {
      schema: OD_NEXT_REQUEST_INPUT_FACTS_SCHEMA_V1,
      attachments: facts,
      comments: { count: Math.max(0, Math.floor(input.commentCount ?? 0)) },
      workspace: {
        project: { reference: 'workspace:project', access: 'out_of_band' },
        linkedDirectories: Array.from({ length: linkedDirectoryCount }, (_, index) => ({
          reference: `linked-dir:${index + 1}`,
          access: 'out_of_band' as const,
        })),
      },
      mcp: {
        serverCount: Math.max(0, Math.floor(input.mcpServerCount ?? 0)),
        registration: 'out_of_band',
      },
    };
    const manifest: SnapshotManifest = {
      schema: SNAPSHOT_SCHEMA,
      taskExecutionId,
      taskConfiguration: input.taskConfiguration,
      requestInputFacts,
      files,
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const manifestPath = path.join(snapshotDir, 'manifest.json');
    fs.writeFileSync(manifestPath, manifestBytes, { flag: 'wx', mode: 0o400 });
    return { taskExecutionId, snapshotDir, manifestSha256: sha256(manifestBytes) };
  } catch (error) {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    throw error;
  }
}

function parseManifest(bytes: Buffer): SnapshotManifest {
  const parsed = JSON.parse(bytes.toString('utf8')) as SnapshotManifest;
  if (
    parsed?.schema !== SNAPSHOT_SCHEMA
    || typeof parsed.taskExecutionId !== 'string'
    || !Array.isArray(parsed.files)
    || parsed.taskConfiguration?.schema !== OD_NEXT_TASK_CONFIGURATION_SCHEMA_V1
    || parsed.requestInputFacts?.schema !== OD_NEXT_REQUEST_INPUT_FACTS_SCHEMA_V1
  ) {
    throw new OdNextTaskInputSnapshotError('OD Next task input manifest is invalid.');
  }
  return parsed;
}

export function loadOdNextTaskInputSnapshot(
  descriptor: OdNextTaskInputSnapshotDescriptor,
  snapshotsRoot: string,
): LoadedOdNextTaskInputSnapshot {
  const root = fs.realpathSync(path.resolve(snapshotsRoot));
  const snapshotDir = fs.realpathSync(descriptor.snapshotDir);
  if (!within(root, snapshotDir) || path.basename(snapshotDir) !== safeTaskId(descriptor.taskExecutionId)) {
    throw new OdNextTaskInputSnapshotError('OD Next task input snapshot is outside its managed root.');
  }
  const manifestPath = path.join(snapshotDir, 'manifest.json');
  if (fs.lstatSync(manifestPath).isSymbolicLink()) {
    throw new OdNextTaskInputSnapshotError('OD Next task input manifest must not be a symlink.');
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  if (sha256(manifestBytes) !== descriptor.manifestSha256) {
    throw new OdNextTaskInputSnapshotError('OD Next task input manifest digest mismatch.', 'OD_NEXT_INPUT_SNAPSHOT_TAMPERED');
  }
  const manifest = parseManifest(manifestBytes);
  if (manifest.taskExecutionId !== descriptor.taskExecutionId) {
    throw new OdNextTaskInputSnapshotError('OD Next task input manifest ownership mismatch.');
  }
  const pathsById = new Map<string, string>();
  for (const file of manifest.files) {
    if (!/^attachments\/attachment-[0-9]{3}\.[a-z0-9]+$/.test(file.relativePath)) {
      throw new OdNextTaskInputSnapshotError('OD Next task input file reference is invalid.');
    }
    const absolute = path.resolve(snapshotDir, file.relativePath);
    if (!within(snapshotDir, absolute) || fs.lstatSync(absolute).isSymbolicLink()) {
      throw new OdNextTaskInputSnapshotError('OD Next task input file escapes its snapshot.');
    }
    const bytes = fs.readFileSync(absolute);
    const detected = mediaTypeFromBytes(bytes);
    if (
      bytes.length !== file.bytes
      || sha256(bytes) !== file.sha256
      || detected.mediaType !== file.mediaType
    ) {
      throw new OdNextTaskInputSnapshotError('OD Next task input file identity mismatch.', 'OD_NEXT_INPUT_SNAPSHOT_TAMPERED');
    }
    pathsById.set(file.id, absolute);
  }
  if (
    manifest.requestInputFacts.attachments.length !== manifest.files.length
    || manifest.requestInputFacts.attachments.some((fact, index) => (
      fact.id !== manifest.files[index]?.id
      || fact.order !== index + 1
      || fact.reference !== `task-input:${manifest.files[index]?.relativePath}`
      || fact.sha256 !== manifest.files[index]?.sha256
      || fact.bytes !== manifest.files[index]?.bytes
      || fact.mediaType !== manifest.files[index]?.mediaType
      || fact.kind !== manifest.files[index]?.kind
    ))
  ) {
    throw new OdNextTaskInputSnapshotError('OD Next task input facts do not match frozen files.', 'OD_NEXT_INPUT_SNAPSHOT_TAMPERED');
  }
  const attachmentPaths = manifest.requestInputFacts.attachments.map((fact) => pathsById.get(fact.id)!);
  const imagePaths = manifest.requestInputFacts.attachments
    .filter((fact) => fact.kind === 'image')
    .map((fact) => pathsById.get(fact.id)!);
  return {
    taskConfigText: serializeOdNextTaskConfigurationV1(manifest.taskConfiguration),
    requestInputText: serializeOdNextRequestInputFactsV1(manifest.requestInputFacts),
    attachmentReferences: manifest.requestInputFacts.attachments.map((fact) => fact.reference),
    attachmentPaths,
    imagePaths,
    snapshotDir,
  };
}

export function removeOdNextTaskInputSnapshot(
  descriptor: OdNextTaskInputSnapshotDescriptor | null | undefined,
): void {
  if (!descriptor) return;
  fs.rmSync(descriptor.snapshotDir, { recursive: true, force: true });
}
