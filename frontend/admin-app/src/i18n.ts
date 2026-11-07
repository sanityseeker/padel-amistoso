import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import spanish from './locales/es.json';

export type Language = 'en' | 'es';
export const LANGUAGE_KEY = 'amistoso-lang';
function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    const old = localStorage.getItem('padel-lang');
    if (!saved && (old === 'en' || old === 'es')) {
      localStorage.setItem(LANGUAGE_KEY, old);
      localStorage.removeItem('padel-lang');
      return old;
    }
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    /* Use the browser language when storage is unavailable. */
  }
  return (navigator.languages?.[0] || navigator.language).toLowerCase().startsWith('es')
    ? 'es'
    : 'en';
}

export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  lng: initialLanguage(),
  fallbackLng: 'en',
  supportedLngs: ['en', 'es'],
  resources: { en: { translation: {} }, es: { translation: spanish } },
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
  react: { useSuspense: false },
});
function syncLanguage(language: string) {
  const lang = language === 'es' ? 'es' : 'en';
  document.documentElement.lang = lang;
  const section =
    window.location.pathname === '/events'
      ? 'Events'
      : window.location.pathname === '/player'
        ? 'Player Hub'
        : 'Administration';
  document.title = t(section) + ' · Torneos Amistosos';
  try {
    localStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    /* Session-only language. */
  }
}
i18n.on('languageChanged', syncLanguage);
syncLanguage(i18n.language);
window.addEventListener('storage', (event) => {
  if (event.key === LANGUAGE_KEY && (event.newValue === 'en' || event.newValue === 'es'))
    void i18n.changeLanguage(event.newValue);
});

// Pure formatters and mutation notifications can use t; rendered components
// subscribe with useLocale so a language change updates without a remount.
export function t(text: string, params?: Record<string, unknown>): string {
  return String(i18n.t(text, { ...params, defaultValue: text }));
}
export function useLocale() {
  useTranslation(undefined, { i18n });
  return i18n.language === 'es' ? 'es-ES' : 'en-GB';
}
