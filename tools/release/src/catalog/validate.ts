import {
  CATALOG_SCHEMA_VERSION,
  catalogIdentityKey,
  catalogPublicRoute,
  type CatalogDocument,
  type CatalogRecord,
} from "./schema.ts";

export type ValidateCatalogResult = {
  ok: true;
} | {
  ok: false;
  errors: string[];
};

const RECORD_TYPES = new Set(["skill", "system", "craft", "template", "plugin"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateRecord(record: CatalogRecord, index: number, errors: string[]): void {
  const prefix = `records[${index}]`;
  if (!isNonEmptyString(record.id)) {
    errors.push(`${prefix}.id must be a non-empty string`);
  }
  if (!RECORD_TYPES.has(record.type)) {
    errors.push(`${prefix}.type must be one of skill|system|craft|template|plugin`);
  }
  if (!isNonEmptyString(record.name)) {
    errors.push(`${prefix}.name must be a non-empty string`);
  }
  if (typeof record.description !== "string") {
    errors.push(`${prefix}.description must be a string`);
  }
  if (!isNonEmptyString(record.sourceUrl) || !record.sourceUrl.startsWith("https://github.com/nexu-io/open-design/")) {
    errors.push(`${prefix}.sourceUrl must be a nexu-io/open-design GitHub URL`);
  }
  if (typeof record.body !== "string") {
    errors.push(`${prefix}.body must be a string`);
  }
  const preview = "preview" in record ? record.preview : undefined;
  if (preview?.path != null) {
    if (typeof preview.path !== "string" || !preview.path.startsWith("previews/")) {
      errors.push(`${prefix}.preview.path must start with previews/`);
    }
    if (preview.path.includes("..") || preview.path.endsWith(".html")) {
      errors.push(`${prefix}.preview.path must not escape or reference html`);
    }
  }

  if (record.type === "skill") {
    if (record.kind !== "instruction" && record.kind !== "template") {
      errors.push(`${prefix}.kind must be instruction|template`);
    }
    if (!Array.isArray(record.triggers)) {
      errors.push(`${prefix}.triggers must be an array`);
    }
  }
  if (record.type === "template") {
    if (record.origin !== "design-template" && record.origin !== "live-artifact") {
      errors.push(`${prefix}.origin must be design-template|live-artifact`);
    }
    if (!isNonEmptyString(record.detailHref) || !record.detailHref.startsWith("/templates/")) {
      errors.push(`${prefix}.detailHref must be a /templates/<id>/ path`);
    }
  }
  if (record.type === "plugin") {
    if (!isNonEmptyString(record.slug)) {
      errors.push(`${prefix}.slug must be a non-empty string`);
    }
    if (!isNonEmptyString(record.bucket)) {
      errors.push(`${prefix}.bucket must be a non-empty string`);
    }
    if (!isNonEmptyString(record.detailSlug)) {
      errors.push(`${prefix}.detailSlug must be a non-empty string`);
    }
    if (!isNonEmptyString(record.detailHref) || !record.detailHref.startsWith("/plugins/")) {
      errors.push(`${prefix}.detailHref must be a /plugins/<slug>/ path`);
    }
    if (record.kind === "atom" && record.discoverable !== false) {
      errors.push(`${prefix} atom plugins must set discoverable: false`);
    }
    if (record.discoverable === false && record.kind !== "atom") {
      // Allow non-atom undiscoverable later; only warn via kind check for atoms above.
    }
    if (!Array.isArray(record.tags)) {
      errors.push(`${prefix}.tags must be an array`);
    }
  }
  if (record.type === "system") {
    if (!isNonEmptyString(record.category)) {
      errors.push(`${prefix}.category must be a non-empty string`);
    }
    if (typeof record.tagline !== "string") {
      errors.push(`${prefix}.tagline must be a string`);
    }
    if (typeof record.atmosphere !== "string") {
      errors.push(`${prefix}.atmosphere must be a string`);
    }
    if (!Array.isArray(record.palette)) {
      errors.push(`${prefix}.palette must be an array`);
    }
  }
  if (record.type === "craft") {
    if (typeof record.summary !== "string") {
      errors.push(`${prefix}.summary must be a string`);
    }
  }
}

/**
 * Fail closed on schema, (type,id) identity, public-route, and source-URL conflicts.
 * Stable ids may collide across types (e.g. skill+system `replicate`).
 */
export function validateCatalog(catalog: unknown): ValidateCatalogResult {
  const errors: string[] = [];

  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    return { ok: false, errors: ["catalog must be an object"] };
  }

  const doc = catalog as CatalogDocument;
  if (doc.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CATALOG_SCHEMA_VERSION}`);
  }
  if (!isNonEmptyString(doc.sourceCommit) || !/^[0-9a-f]{40}$/i.test(doc.sourceCommit)) {
    errors.push("sourceCommit must be a full 40-char hex sha");
  }
  if (!isNonEmptyString(doc.generatedAt)) {
    errors.push("generatedAt must be a non-empty ISO timestamp string");
  }
  if (!Array.isArray(doc.records)) {
    errors.push("records must be an array");
    return { ok: false, errors };
  }

  const identities = new Map<string, number>();
  const publicRoutes = new Map<string, string>();
  const sourceUrls = new Map<string, string>();

  for (let i = 0; i < doc.records.length; i += 1) {
    const record = doc.records[i] as CatalogRecord;
    if (!record || typeof record !== "object") {
      errors.push(`records[${i}] must be an object`);
      continue;
    }
    validateRecord(record, i, errors);

    if (isNonEmptyString(record.id) && RECORD_TYPES.has(record.type)) {
      const key = catalogIdentityKey(record.type, record.id);
      const prev = identities.get(key);
      if (prev != null) {
        errors.push(`duplicate identity "${key}" (records[${prev}] and records[${i}])`);
      } else {
        identities.set(key, i);
      }
    }

    const route = catalogPublicRoute(record);
    if (route) {
      const prev = publicRoutes.get(route);
      if (prev != null) {
        errors.push(`duplicate public route "${route}" (${prev} and ${record.type}:${record.id})`);
      } else {
        publicRoutes.set(route, `${record.type}:${record.id}`);
      }
    }

    if (isNonEmptyString(record.sourceUrl)) {
      const prev = sourceUrls.get(record.sourceUrl);
      const identity = `${record.type}:${record.id}`;
      if (prev != null && prev !== identity) {
        errors.push(`duplicate sourceUrl "${record.sourceUrl}" (${prev} and ${identity})`);
      } else {
        sourceUrls.set(record.sourceUrl, identity);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

export function assertValidCatalog(catalog: unknown): asserts catalog is CatalogDocument {
  const result = validateCatalog(catalog);
  if (!result.ok) {
    throw new Error(`catalog validation failed:\n- ${result.errors.join("\n- ")}`);
  }
}
