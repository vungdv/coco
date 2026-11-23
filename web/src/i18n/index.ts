import { ref } from 'vue'
import { en, vi, type MessageKey, type Messages } from './messages'

export type Locale = 'en' | 'vi'
export type { MessageKey }

const catalogs: Record<Locale, Messages> = { en, vi }
/** BCP 47 tags handed to Intl formatters. */
export const intlTag: Record<Locale, string> = { en: 'en-US', vi: 'vi-VN' }
export const locales: Locale[] = ['en', 'vi']

const STORAGE_KEY = 'bpb:locale'

/** Saved choice first, then the browser's preferred languages (Accept-Language order), else English. */
export function detectLocale(saved: string | null, preferred: readonly string[]): Locale {
  if (saved === 'en' || saved === 'vi') return saved
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    if (base === 'en' || base === 'vi') return base
  }
  return 'en'
}

function readSaved(): string | null {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

export const locale = ref<Locale>(detectLocale(readSaved(),
  typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]))

function applyDocumentLang(l: Locale) {
  if (typeof document !== 'undefined') document.documentElement.lang = l
}
applyDocumentLang(locale.value)

export function setLocale(l: Locale) {
  locale.value = l
  applyDocumentLang(l)
  try { localStorage.setItem(STORAGE_KEY, l) } catch { /* ignore */ }
}

/** Translate `key` for `l` (defaults to the active locale), filling `{param}` placeholders. */
export function translate(l: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const msg = catalogs[l][key] ?? en[key]
  return params ? msg.replace(/\{(\w+)\}/g, (m, p) => (p in params ? String(params[p]) : m)) : msg
}

/** Reactive in templates: reads `locale`, so components re-render when it changes. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return translate(locale.value, key, params)
}
