import type { Language, PageKey, SiteCopy } from '../i18n/types';
import { LanguageSwitcher } from './language-switcher';

const routes: Array<{ key: PageKey; href: string }> = [
  { key: 'home', href: '/' },
  { key: 'privacy', href: '/privacy' },
  { key: 'terms', href: '/terms' },
  { key: 'support', href: '/support' },
];

type SiteHeaderProps = {
  copy: SiteCopy;
  language: Language;
  page: PageKey;
  onLanguageChange: (language: Language) => void;
};

export function SiteHeader({
  copy,
  language,
  page,
  onLanguageChange,
}: SiteHeaderProps) {
  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="HomeyPaw home">
        <img src="/homeypaw-mark.png" alt="" />
        <span>HomeyPaw</span>
      </a>
      <nav aria-label={language === 'zh-HK' ? '主要導覽' : 'Primary'}>
        {routes.map((route) => (
          <a
            aria-current={page === route.key ? 'page' : undefined}
            href={route.href}
            key={route.key}
          >
            {copy.nav[route.key]}
          </a>
        ))}
      </nav>
      <LanguageSwitcher
        label={copy.languageButton}
        language={language}
        onChange={onLanguageChange}
      />
    </header>
  );
}
