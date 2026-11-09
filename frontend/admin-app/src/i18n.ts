import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { notifications } from '@mantine/notifications';
import spanish from './locales/es.json';

export const LANGUAGES = [
  { code: 'en', name: 'English', short: 'EN', tag: 'en-GB' },
  { code: 'es', name: 'Español', short: 'ES', tag: 'es-ES' },
  { code: 'ru', name: 'Русский', short: 'RU', tag: 'ru-RU' },
] as const;
export type Language = (typeof LANGUAGES)[number]['code'];
/** Languages a person can pick today. A stored language outside this list is still honored. */
export const SELECTABLE: readonly Language[] = ['en', 'es', 'ru'];
export const LANGUAGE_KEY = 'amistoso-lang';
// Languages whose texts load on demand instead of in the entry chunk.
const LAZY: Partial<Record<Language, () => Promise<{ default: Record<string, string> }>>> = {
  ru: () => import('./locales/ru.json'),
};
const isLanguage = (value: unknown): value is Language =>
  LANGUAGES.some((language) => language.code === value);
function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    const old = localStorage.getItem('padel-lang');
    if (!saved && (old === 'en' || old === 'es')) {
      localStorage.setItem(LANGUAGE_KEY, old);
      localStorage.removeItem('padel-lang');
      return old;
    }
    if (isLanguage(saved)) return saved;
  } catch {
    /* Use the browser language when storage is unavailable. */
  }
  const browser = (navigator.languages?.[0] || navigator.language).toLowerCase();
  if (browser.startsWith('es')) return 'es';
  return browser.startsWith('ru') ? 'ru' : 'en';
}

const wanted = initialLanguage();
export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  // A lazy language starts in English; `ready` switches once its texts have loaded.
  lng: LAZY[wanted] ? 'en' : wanted,
  fallbackLng: 'en',
  supportedLngs: LANGUAGES.map((language) => language.code),
  resources: { en: { translation: {} }, es: { translation: spanish } },
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
  react: { useSuspense: false },
});

export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : 'en';
}
export function localeTag(language: Language = currentLanguage()): string {
  return LANGUAGES.find((entry) => entry.code === language)?.tag ?? 'en-GB';
}

async function loadBundle(language: Language) {
  const load = LAZY[language];
  if (!load || i18n.hasResourceBundle(language, 'translation')) return;
  const bundle = await load();
  i18n.addResourceBundle(language, 'translation', bundle.default, true, true);
}

function syncLanguage(language: string) {
  const lang = isLanguage(language) ? language : 'en';
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    /* Session-only language. */
  }
}
i18n.on('languageChanged', syncLanguage);

/** Resolves when the first language is in place. If a stored lazy language fails to load, this
 * visit shows English and the stored choice is left alone. */
export const ready: Promise<void> = (async () => {
  if (!LAZY[wanted]) {
    syncLanguage(i18n.language);
    return;
  }
  try {
    await loadBundle(wanted);
    await i18n.changeLanguage(wanted);
  } catch {
    document.documentElement.lang = 'en';
  }
})();

/** Switches the language. A failed load keeps the current language and tells the person. */
export async function setLanguage(language: Language): Promise<boolean> {
  if (language === currentLanguage()) return true;
  try {
    await loadBundle(language);
    await i18n.changeLanguage(language);
    return true;
  } catch {
    notifications.show({
      color: 'red',
      message: t('Could not load the language. The current language stays.'),
    });
    return false;
  }
}
window.addEventListener('storage', (event) => {
  if (event.key === LANGUAGE_KEY && isLanguage(event.newValue) && event.newValue !== i18n.language)
    void setLanguage(event.newValue);
});

// Pure formatters and mutation notifications can use t; rendered components
// subscribe with useLocale so a language change updates without a remount.
export function t(text: string, params?: Record<string, unknown>): string {
  return String(i18n.t(text, { ...params, defaultValue: text }));
}
export function useLocale() {
  useTranslation(undefined, { i18n });
  return localeTag();
}
