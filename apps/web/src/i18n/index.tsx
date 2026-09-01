'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { en } from './locales/en';
import { getOpenDesignHost } from '@open-design/host';
import { LOCALES, type Dict, type Locale } from './types';

export { LOCALES, LOCALE_LABEL } from './types';
export type { Locale } from './types';

type DictKey = keyof Dict;

const DICTS: Partial<Record<Locale, Dict>> = {
  'en': en,
};

const LS_KEY = 'open-design:locale';
// Marker that says "the value in LS_KEY came from a deliberate user
// action through setLocale, not from some auto-detection path". Only
// values tagged this way win over the desktop host's injected OS
// locale, so a stale auto-detected pick can't pin the app forever once
// the user changes their system language.
const LS_SOURCE_KEY = 'open-design:locale-source';
const MANUAL_LOCALE_SOURCE = 'manual';

// Single-tenant English-only deployment: the only bundled locale is `en`,
// so system-language detection can never resolve anything else. Kept as a
// function (rather than deleted) so the export surface and its callers stay
// unchanged against upstream.
export function resolveSystemLocale(languages: readonly string[]): Locale | null {
  for (const raw of languages) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized === 'en' || normalized.split('-')[0] === 'en') return 'en';
  }
  return null;
}

/**
 * A `t()` bound to an explicit content-language tag rather than the app UI
 * locale. Used by the question-form card so host-rendered strings inside the
 * card (the "Other" chip, custom-answer copy) match the language the model
 * localized the form into — a Chinese form in an English UI must not mix
 * scripts. Returns null when the tag doesn't resolve to a bundled locale;
 * callers fall back to the context `t`.
 */
export function tForLanguageTag(
  tag: string | undefined,
): ((key: DictKey, vars?: Record<string, string | number>) => string) | null {
  if (!tag || !tag.trim()) return null;
  const locale = resolveSystemLocale([tag]);
  if (!locale) return null;
  const dict = DICTS[locale] ?? en;
  return (key, vars) => {
    const raw = dict[key] ?? en[key] ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
      const v = vars[name];
      return v == null ? `{${name}}` : String(v);
    });
  };
}

// Read the OS locale the desktop host attached to its client descriptor.
// Packaged desktop builds need this because Chromium otherwise reports
// en-US through navigator.language regardless of the OS setting. We go
// through `getOpenDesignHost` rather than reading the bridge global by
// name so the web/preload boundary stays single-source (see the
// `host bridge boundary` guard test).
function readDesktopHostOsLocale(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const host = getOpenDesignHost();
  const value = host?.client?.osLocale;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// Single-tenant English-only deployment (Fountain Hills Chamber of
// Commerce). The UI ships one dictionary, so browser / OS language must
// never be able to flip the app into a locale we do not bundle. The
// function is kept (rather than removed) so the export surface, its
// callers and its tests stay put — it simply short-circuits to 'en'.
// The localStorage / desktop-host detection chain below is intentionally
// unreachable; restore it here if more locales are ever bundled again.
export function detectInitialLocale(): Locale {
  return 'en';
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// Stand-alone English translator used when no provider is mounted (e.g. an
// isolated test). It MUST be a module-level singleton, not rebuilt per render:
// components legitimately list `t` in effect dependency arrays, and inside the
// provider `t` is identity-stable (useCallback on [locale]). A fresh closure
// here would break that contract only on the provider-less path, turning any
// such effect into an infinite render loop that spins instead of failing —
// which reads as a hung test suite rather than a bug.
const FALLBACK_I18N: I18nContextValue = {
  locale: 'en',
  setLocale: () => { },
  t: (key, vars) => {
    const raw = en[key] ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, n: string) => {
      const v = vars[n];
      return v == null ? `{${n}}` : String(v);
    });
  },
};

interface ProviderProps {
  initial?: Locale;
  children: ReactNode;
}

// English-only deployment: no RTL locales are bundled.
const RTL_LOCALES: Locale[] = [];

export function I18nProvider({ initial, children }: ProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? detectInitialLocale());

  // Keep <html lang="…" dir="…"> in sync so screen readers and CSS hooks
  // pick the right language token and direction without each component
  // having to set it itself.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
      document.documentElement.setAttribute('lang', locale);
      document.documentElement.setAttribute('dir', dir);
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LS_KEY, next);
      // Marker so detectInitialLocale knows this came from a deliberate
      // user action and should beat the desktop host's OS locale.
      window.localStorage.setItem(LS_SOURCE_KEY, MANUAL_LOCALE_SOURCE);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: DictKey, vars?: Record<string, string | number>): string => {
      const dict = DICTS[locale] ?? en;
      const raw = dict[key] ?? en[key] ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
        const v = vars[name];
        return v == null ? `{${name}}` : String(v);
      });
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  // Falling back keeps the API safe to call without requiring every callsite
  // to wrap in a provider. See FALLBACK_I18N on why it is a shared singleton.
  return useContext(I18nContext) ?? FALLBACK_I18N;
}

// Convenience for components that only need the translator function.
export function useT(): I18nContextValue['t'] {
  return useI18n().t;
}
