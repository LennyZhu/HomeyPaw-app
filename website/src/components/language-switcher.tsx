import type { Language } from '../i18n/types';

type LanguageSwitcherProps = {
  label: string;
  language: Language;
  onChange: (language: Language) => void;
};

export function LanguageSwitcher({
  label,
  language,
  onChange,
}: LanguageSwitcherProps) {
  const nextLanguage = language === 'zh-HK' ? 'en' : 'zh-HK';

  return (
    <button
      aria-label={language === 'zh-HK' ? 'Switch to English' : '切換至繁體中文'}
      className="language-button"
      onClick={() => onChange(nextLanguage)}
      type="button"
    >
      {label}
    </button>
  );
}
