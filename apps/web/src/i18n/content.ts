import type {
  DesignSystemSummary,
  PromptTemplateSummary,
  SkillSummary,
} from '../types';
import type { Locale } from './types';

// Single-tenant English-only deployment (Fountain Hills Chamber of Commerce).
// Upstream ships per-locale overlays for built-in skill / design-system /
// prompt-template copy; this fork bundles only English, so the localize*
// helpers below are identity functions over the English source content. The
// export surface is kept identical to upstream so every call site (and the
// plugin / design-system views) stay unchanged.

type LocalizedSkillCopy = { description?: string; examplePrompt?: string };
type LocalizedPromptTemplateCopy = Partial<Pick<PromptTemplateSummary, 'summary' | 'title'>>;
type LocalizedContentIds = {
  skills: string[];
  designSystems: string[];
  designSystemCategories: string[];
  promptTemplates: string[];
  promptTemplateCategories: string[];
  promptTemplateTags: string[];
};
type LocalizedContentBundle = {
  skillCopy: Record<string, LocalizedSkillCopy>;
  designSystemSummaries: Record<string, string>;
  designSystemCategories: Record<string, string>;
  promptTemplateCategories: Record<string, string>;
  promptTemplateTags: Record<string, string>;
  promptTemplateCopy: Record<string, LocalizedPromptTemplateCopy>;
};

const EMPTY_CONTENT_IDS: LocalizedContentIds = {
  skills: [],
  designSystems: [],
  designSystemCategories: [],
  promptTemplates: [],
  promptTemplateCategories: [],
  promptTemplateTags: [],
};

// No non-English overlays are bundled. Kept so upstream imports resolve.
export const LOCALIZED_CONTENT_IDS = {
  de: EMPTY_CONTENT_IDS,
  ru: EMPTY_CONTENT_IDS,
  fr: EMPTY_CONTENT_IDS,
} satisfies Record<'de' | 'ru' | 'fr', LocalizedContentIds>;

export const GERMAN_CONTENT_IDS = LOCALIZED_CONTENT_IDS.de;
export const RUSSIAN_CONTENT_IDS = LOCALIZED_CONTENT_IDS.ru;
export const FRENCH_CONTENT_IDS = LOCALIZED_CONTENT_IDS.fr;

// True when a locale resolves a built-in-content overlay. English is the
// source language and needs no overlay, so this is always false here.
export function hasLocalizedContent(_locale: Locale): boolean {
  return false;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function localizedRecordValue(
  locale: Locale,
  values: Record<string, string> | undefined,
): string | undefined {
  if (!values) return undefined;
  if (values[locale]) return values[locale];
  if (values.en) return values.en;
  return undefined;
}

export function localizeSkillName(locale: Locale, skill: SkillSummary): string {
  return localizedRecordValue(locale, skill.displayName) ?? skill.name;
}

export function localizeSkillPrompt(locale: Locale, skill: SkillSummary): string | undefined {
  const inline = localizedRecordValue(locale, skill.examplePromptI18n);
  if (inline) return inline;
  return skill.examplePrompt ? normalizeText(skill.examplePrompt) : undefined;
}

export function localizeSkillDescription(locale: Locale, skill: SkillSummary): string {
  const inline = localizedRecordValue(locale, skill.descriptionI18n);
  if (inline) return inline;
  return normalizeText(skill.description);
}

export function localizeDesignSystemSummary(
  _locale: Locale,
  system: DesignSystemSummary,
): string {
  return system.summary || system.category || '';
}

export function localizeDesignSystemCategory(_locale: Locale, category: string): string {
  return category;
}

export function localizePromptTemplateCategory(_locale: Locale, category: string): string {
  return category;
}

export function localizePromptTemplateSummary(
  _locale: Locale,
  template: PromptTemplateSummary,
): PromptTemplateSummary {
  return template;
}

export type { LocalizedContentBundle, LocalizedContentIds };
