import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import zhHK from './locales/zh-HK.json';

export const supportedLanguages = ['zh-HK', 'en'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

const resources = {
  'zh-HK': { translation: zhHK },
  en: { translation: en },
} as const;

const i18n = createInstance();

void i18n.use(initReactI18next).init({
  resources,
  lng: 'zh-HK',
  fallbackLng: 'zh-HK',
  supportedLngs: supportedLanguages,
  interpolation: {
    escapeValue: false,
  },
});

export function getDeviceLanguage(): SupportedLanguage {
  const locale = getLocales()[0];
  return locale?.languageCode === 'en' ? 'en' : 'zh-HK';
}

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return supportedLanguages.includes(value as SupportedLanguage);
}

export default i18n;
