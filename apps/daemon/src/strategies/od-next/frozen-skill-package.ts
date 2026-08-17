import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertOdNextPlanningBuildOnlyV2 } from '@open-design/contracts';
import type Database from 'better-sqlite3';

import { parseFrontmatter } from '../../design-systems/frontmatter.js';
import {
  findSkillById,
  resolveSkillId,
  splitDerivedSkillId,
  type SkillInfo,
} from '../../skills.js';

type SqliteDb = Database.Database;

export const OD_NEXT_FROZEN_SKILL_PACKAGE_SCHEMA =
  'open-design.od-next-frozen-skill-package/v1' as const;
const MAX_SKILL_COUNT = 8;
const MAX_SIDE_FILE_COUNT = 32;
const MAX_SKILL_BODY_BYTES = 256 * 1024;
const MAX_SIDE_FILE_BYTES = 256 * 1024;
const MAX_PACKAGE_BYTES = 1024 * 1024;
const SIDE_FILE_REFERENCE = /\b(?:assets|references|scripts|examples)\/[A-Za-z0-9._/-]+\b/g;

export interface FrozenSkillFileV1 {
  path: string;
  bytesBase64: string;
  byteLength: number;
  digest: string;
}

export interface FrozenSkillSelectionV1 {
  canonicalId: string;
  name: string;
  body: string;
  bodyByteLength: number;
  bodyDigest: string;
  files: FrozenSkillFileV1[];
}

export interface FrozenSkillPackageV1 {
  schema: typeof OD_NEXT_FROZEN_SKILL_PACKAGE_SCHEMA;
  identity: string;
  selections: FrozenSkillSelectionV1[];
}

export class InvalidFrozenSkillPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFrozenSkillPackageError';
  }
}

export function normalizeSelectedSkillIds(input: {
  skillId?: unknown;
  skillIds?: unknown;
}): string[] {
  const raw = [
    ...(typeof input.skillId === 'string' ? [input.skillId] : []),
    ...(Array.isArray(input.skillIds) ? input.skillIds : []),
  ];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') {
      throw new InvalidFrozenSkillPackageError('Selected Skill ids must be strings.');
    }
    const requested = value.trim();
    if (!requested) continue;
    const canonical = resolveSkillId(requested);
    if (typeof canonical !== 'string' || !canonical.trim()) {
      throw new InvalidFrozenSkillPackageError(`Selected Skill ${requested} has no canonical id.`);
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    normalized.push(canonical);
  }
  if (normalized.length > MAX_SKILL_COUNT) {
    throw new InvalidFrozenSkillPackageError(
      `OD Next accepts at most ${MAX_SKILL_COUNT} explicitly selected Skills.`,
    );
  }
  return normalized;
}

export async function captureFrozenSkillPackage(input: {
  skillId?: unknown;
  skillIds?: unknown;
  catalog: readonly SkillInfo[];
}): Promise<FrozenSkillPackageV1> {
  const ids = normalizeSelectedSkillIds(input);
  const selections: FrozenSkillSelectionV1[] = [];
  let packageBytes = 0;
  for (const canonicalId of ids) {
    const skill = findSkillById(input.catalog, canonicalId);
    if (!skill) {
      throw new InvalidFrozenSkillPackageError(`Selected Skill ${canonicalId} is unavailable.`);
    }
    const selection = await captureSelection(skill);
    packageBytes += selection.bodyByteLength;
    packageBytes += selection.files.reduce((sum, file) => sum + file.byteLength, 0);
    if (packageBytes > MAX_PACKAGE_BYTES) {
      throw new InvalidFrozenSkillPackageError(
        `Frozen Skill package exceeds ${MAX_PACKAGE_BYTES} bytes.`,
      );
    }
    selections.push(selection);
  }
  const packageWithoutIdentity = {
    schema: OD_NEXT_FROZEN_SKILL_PACKAGE_SCHEMA,
    selections,
  };
  return {
    ...packageWithoutIdentity,
    identity: digestUtf8(canonicalJson(packageIdentityInput(packageWithoutIdentity))),
  };
}

export function migrateFrozenSkillPackageStore(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_task_frozen_skill_packages (
      task_execution_id TEXT PRIMARY KEY,
      schema TEXT NOT NULL,
      identity TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY(task_execution_id) REFERENCES strategy_task_executions(task_execution_id)
        ON DELETE CASCADE
    );
  `);
}

export function insertFrozenSkillPackage(
  db: SqliteDb,
  taskExecutionId: string,
  frozen: FrozenSkillPackageV1,
): void {
  const verified = verifyFrozenSkillPackage(frozen);
  db.prepare(`
    INSERT INTO strategy_task_frozen_skill_packages (
      task_execution_id, schema, identity, payload_json
    ) VALUES (?, ?, ?, ?)
  `).run(taskExecutionId, verified.schema, verified.identity, canonicalJson(verified));
}

export function getFrozenSkillPackage(
  db: SqliteDb,
  taskExecutionId: string,
): FrozenSkillPackageV1 | null {
  const row = db.prepare(`
    SELECT schema, identity, payload_json AS payloadJson
      FROM strategy_task_frozen_skill_packages
     WHERE task_execution_id = ?
  `).get(taskExecutionId) as {
    schema?: unknown;
    identity?: unknown;
    payloadJson?: unknown;
  } | undefined;
  if (!row) return null;
  if (
    row.schema !== OD_NEXT_FROZEN_SKILL_PACKAGE_SCHEMA
    || typeof row.identity !== 'string'
    || typeof row.payloadJson !== 'string'
  ) {
    throw new InvalidFrozenSkillPackageError('Frozen Skill package row is malformed.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payloadJson);
  } catch {
    throw new InvalidFrozenSkillPackageError('Frozen Skill package JSON is malformed.');
  }
  const verified = verifyFrozenSkillPackage(parsed);
  if (verified.identity !== row.identity || canonicalJson(verified) !== row.payloadJson) {
    throw new InvalidFrozenSkillPackageError('Frozen Skill package identity is tampered.');
  }
  return verified;
}

export function renderFrozenSkillBundleContext(frozen: FrozenSkillPackageV1): string {
  const verified = verifyFrozenSkillPackage(frozen);
  if (verified.selections.length === 0) {
    return canonicalJson({
      schema: verified.schema,
      identity: verified.identity,
      selectedSkills: [],
    });
  }
  return [
    canonicalJson({
      schema: verified.schema,
      identity: verified.identity,
      selectedSkills: verified.selections.map((selection) => ({
        id: selection.canonicalId,
        materializedRoot: frozenSkillMaterializedRoot(verified, selection),
        bodyDigest: selection.bodyDigest,
        bodyBytes: selection.bodyByteLength,
        files: selection.files.map((file) => ({
          path: file.path,
          digest: file.digest,
          bytes: file.byteLength,
        })),
      })),
    }),
    ...verified.selections.map((selection) => [
      `## User-selected Skill — ${selection.name}`,
      `Frozen identity: ${selection.canonicalId}@${selection.bodyDigest}`,
      `Frozen side-file root: ${frozenSkillMaterializedRoot(verified, selection)}`,
      selection.body,
    ].join('\n\n')),
  ].join('\n\n---\n\n');
}

export async function materializeFrozenSkillPackage(input: {
  frozen: FrozenSkillPackageV1;
  cwd: string;
}): Promise<string[]> {
  const frozen = verifyFrozenSkillPackage(input.frozen);
  const aliasRoot = path.join(input.cwd, '.od-skills');
  await assertDestinationRoot(aliasRoot);
  await mkdir(aliasRoot, { recursive: true });
  const materialized: string[] = [];
  for (const selection of frozen.selections) {
    const segment = frozenSkillMaterializedRoot(frozen, selection).slice('.od-skills/'.length);
    const destination = path.join(aliasRoot, segment);
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, 'SKILL.md'), selection.body, {
      encoding: 'utf8',
      flag: 'wx',
    });
    for (const file of selection.files) {
      const target = path.join(destination, ...file.path.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      const bytes = Buffer.from(file.bytesBase64, 'base64');
      await writeFile(target, bytes, { flag: 'wx' });
    }
    materialized.push(`.od-skills/${segment}`);
  }
  return materialized;
}

async function captureSelection(skill: SkillInfo): Promise<FrozenSkillSelectionV1> {
  const rootStat = await lstat(skill.dir).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new InvalidFrozenSkillPackageError(`Selected Skill ${skill.id} root is not a real directory.`);
  }
  const root = await realpath(skill.dir);
  const manifestPath = path.join(root, 'SKILL.md');
  const manifestStat = await lstat(manifestPath).catch(() => null);
  if (!manifestStat?.isFile() || manifestStat.isSymbolicLink()) {
    throw new InvalidFrozenSkillPackageError(`Selected Skill ${skill.id} has no safe SKILL.md.`);
  }
  const raw = await readFile(manifestPath, 'utf8');
  const manifestAfter = await lstat(manifestPath);
  if (
    manifestAfter.dev !== manifestStat.dev
    || manifestAfter.ino !== manifestStat.ino
    || manifestAfter.size !== manifestStat.size
    || manifestAfter.mtimeMs !== manifestStat.mtimeMs
  ) {
    throw new InvalidFrozenSkillPackageError(`Selected Skill ${skill.id} changed while freezing.`);
  }
  const parsed = parseFrontmatter(raw);
  const declaredId = typeof parsed.data.name === 'string' && parsed.data.name.trim()
    ? parsed.data.name.trim()
    : skill.id;
  const manifestOwnerId = splitDerivedSkillId(skill.id)?.parentId ?? skill.id;
  if (resolveSkillId(declaredId) !== manifestOwnerId) {
    throw new InvalidFrozenSkillPackageError(`Selected Skill ${skill.id} identity changed while freezing.`);
  }
  const body = parsed.body;
  const bodyBytes = Buffer.byteLength(body, 'utf8');
  if (bodyBytes > MAX_SKILL_BODY_BYTES) {
    throw new InvalidFrozenSkillPackageError(`Selected Skill ${skill.id} body is too large.`);
  }
  assertOdNextPlanningBuildOnlyV2(body, `user-selected Skill ${skill.id}`);
  const roster = explicitSideFileRoster(body);
  if (roster.length > MAX_SIDE_FILE_COUNT) {
    throw new InvalidFrozenSkillPackageError(`Selected Skill ${skill.id} references too many side files.`);
  }
  const files: FrozenSkillFileV1[] = [];
  for (const relativePath of roster) {
    files.push(await captureSideFile(root, relativePath));
  }
  return {
    canonicalId: skill.id,
    name: skill.name,
    body,
    bodyByteLength: bodyBytes,
    bodyDigest: digestUtf8(body),
    files,
  };
}

async function captureSideFile(root: string, relativePath: string): Promise<FrozenSkillFileV1> {
  const segments = relativePath.split('/');
  let cursor = root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    const stat = await lstat(cursor).catch(() => null);
    if (!stat || stat.isSymbolicLink()) {
      throw new InvalidFrozenSkillPackageError(`Skill side file ${relativePath} is missing or symlinked.`);
    }
  }
  const fileStat = await lstat(cursor);
  if (!fileStat.isFile()) {
    throw new InvalidFrozenSkillPackageError(`Skill side file ${relativePath} is not a regular file.`);
  }
  const resolved = await realpath(cursor);
  if (!isInside(root, resolved)) {
    throw new InvalidFrozenSkillPackageError(`Skill side file ${relativePath} escapes its Skill root.`);
  }
  const bytes = await readFile(resolved);
  const after = await lstat(resolved);
  if (
    after.dev !== fileStat.dev
    || after.ino !== fileStat.ino
    || after.size !== fileStat.size
    || after.mtimeMs !== fileStat.mtimeMs
  ) {
    throw new InvalidFrozenSkillPackageError(`Skill side file ${relativePath} changed while freezing.`);
  }
  if (bytes.byteLength > MAX_SIDE_FILE_BYTES) {
    throw new InvalidFrozenSkillPackageError(`Skill side file ${relativePath} is too large.`);
  }
  return {
    path: relativePath,
    bytesBase64: bytes.toString('base64'),
    byteLength: bytes.byteLength,
    digest: digestBytes(bytes),
  };
}

function explicitSideFileRoster(body: string): string[] {
  const files = new Set<string>();
  for (const match of body.matchAll(SIDE_FILE_REFERENCE)) {
    const candidate = match[0].replace(/[.,;:)]+$/, '');
    if (!isSafeRelativePath(candidate)) {
      throw new InvalidFrozenSkillPackageError(`Unsafe Skill side-file reference ${candidate}.`);
    }
    files.add(candidate);
  }
  if (/\bexample\.html\b/.test(body)) files.add('example.html');
  return [...files].sort();
}

function verifyFrozenSkillPackage(value: unknown): FrozenSkillPackageV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidFrozenSkillPackageError('Frozen Skill package must be an object.');
  }
  const input = value as Partial<FrozenSkillPackageV1>;
  if (
    input.schema !== OD_NEXT_FROZEN_SKILL_PACKAGE_SCHEMA
    || typeof input.identity !== 'string'
    || !Array.isArray(input.selections)
  ) {
    throw new InvalidFrozenSkillPackageError('Frozen Skill package shape is invalid.');
  }
  if (input.selections.length > MAX_SKILL_COUNT) {
    throw new InvalidFrozenSkillPackageError('Frozen Skill package has too many selections.');
  }
  const selections = input.selections.map((selection) => verifySelection(selection));
  const ids = selections.map((selection) => selection.canonicalId);
  if (new Set(ids).size !== ids.length) {
    throw new InvalidFrozenSkillPackageError('Frozen Skill package contains duplicate selections.');
  }
  const packageBytes = selections.reduce(
    (total, selection) => total
      + selection.bodyByteLength
      + selection.files.reduce((sum, file) => sum + file.byteLength, 0),
    0,
  );
  if (packageBytes > MAX_PACKAGE_BYTES) {
    throw new InvalidFrozenSkillPackageError('Frozen Skill package exceeds its byte limit.');
  }
  const expected = digestUtf8(canonicalJson(packageIdentityInput({
    schema: input.schema,
    selections,
  })));
  if (input.identity !== expected) {
    throw new InvalidFrozenSkillPackageError('Frozen Skill package digest mismatch.');
  }
  return { schema: input.schema, identity: input.identity, selections };
}

function verifySelection(value: unknown): FrozenSkillSelectionV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidFrozenSkillPackageError('Frozen Skill selection is malformed.');
  }
  const selection = value as Partial<FrozenSkillSelectionV1>;
  if (
    typeof selection.canonicalId !== 'string'
    || typeof selection.name !== 'string'
    || typeof selection.body !== 'string'
    || typeof selection.bodyByteLength !== 'number'
    || typeof selection.bodyDigest !== 'string'
    || !Array.isArray(selection.files)
  ) {
    throw new InvalidFrozenSkillPackageError('Frozen Skill selection shape is invalid.');
  }
  if (
    !selection.canonicalId.trim()
    || resolveSkillId(selection.canonicalId) !== selection.canonicalId
    || !selection.name.trim()
    || /[\r\n]/.test(selection.name)
    || selection.name.length > 256
    || selection.bodyByteLength > MAX_SKILL_BODY_BYTES
    || selection.files.length > MAX_SIDE_FILE_COUNT
  ) {
    throw new InvalidFrozenSkillPackageError('Frozen Skill selection bounds are invalid.');
  }
  if (
    Buffer.byteLength(selection.body, 'utf8') !== selection.bodyByteLength
    || digestUtf8(selection.body) !== selection.bodyDigest
  ) {
    throw new InvalidFrozenSkillPackageError(`Frozen Skill ${selection.canonicalId} body is tampered.`);
  }
  const files = selection.files.map((file) => verifyFile(file));
  const filePaths = files.map((file) => file.path);
  if (new Set(filePaths).size !== filePaths.length) {
    throw new InvalidFrozenSkillPackageError(
      `Frozen Skill ${selection.canonicalId} contains duplicate side files.`,
    );
  }
  return { ...selection, files } as FrozenSkillSelectionV1;
}

function verifyFile(value: unknown): FrozenSkillFileV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidFrozenSkillPackageError('Frozen Skill file is malformed.');
  }
  const file = value as Partial<FrozenSkillFileV1>;
  if (
    typeof file.path !== 'string'
    || !isSafeRelativePath(file.path)
    || typeof file.bytesBase64 !== 'string'
    || typeof file.byteLength !== 'number'
    || typeof file.digest !== 'string'
    || file.byteLength > MAX_SIDE_FILE_BYTES
  ) {
    throw new InvalidFrozenSkillPackageError('Frozen Skill file shape is invalid.');
  }
  const bytes = Buffer.from(file.bytesBase64, 'base64');
  if (bytes.toString('base64') !== file.bytesBase64) {
    throw new InvalidFrozenSkillPackageError(`Frozen Skill file ${file.path} is not canonical base64.`);
  }
  if (bytes.byteLength !== file.byteLength || digestBytes(bytes) !== file.digest) {
    throw new InvalidFrozenSkillPackageError(`Frozen Skill file ${file.path} is tampered.`);
  }
  return file as FrozenSkillFileV1;
}

function packageIdentityInput(input: {
  schema: typeof OD_NEXT_FROZEN_SKILL_PACKAGE_SCHEMA;
  selections: FrozenSkillSelectionV1[];
}): unknown {
  return {
    schema: input.schema,
    selections: input.selections.map((selection) => ({
      canonicalId: selection.canonicalId,
      name: selection.name,
      bodyDigest: selection.bodyDigest,
      bodyByteLength: selection.bodyByteLength,
      files: selection.files.map((file) => ({
        path: file.path,
        digest: file.digest,
        byteLength: file.byteLength,
      })),
    })),
  };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
    return Object.fromEntries(Object.entries(current as Record<string, unknown>).sort());
  });
}

function digestUtf8(value: string): string {
  return digestBytes(Buffer.from(value, 'utf8'));
}

function digestBytes(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isSafeRelativePath(value: string): boolean {
  return Boolean(value)
    && !path.posix.isAbsolute(value)
    && !value.includes('\\')
    && !value.includes('\0')
    && value.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function safeSegment(value: string): string {
  const segment = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return segment || 'skill';
}

function frozenSkillMaterializedRoot(
  frozen: FrozenSkillPackageV1,
  selection: FrozenSkillSelectionV1,
): string {
  return `.od-skills/${safeSegment(selection.canonicalId)}-${frozen.identity.slice(7, 17)}`;
}

async function assertDestinationRoot(aliasRoot: string): Promise<void> {
  const stat = await lstat(aliasRoot).catch(() => null);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
    throw new InvalidFrozenSkillPackageError('Frozen Skill materialization root is unsafe.');
  }
}
