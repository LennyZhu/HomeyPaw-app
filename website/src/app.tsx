import { useEffect, useState } from 'react';
import { SiteFooter } from './components/site-footer';
import { SiteHeader } from './components/site-header';
import { en } from './i18n/en';
import type { Language, PageKey } from './i18n/types';
import { zhHK } from './i18n/zh-HK';
import { HomePage } from './pages/home';
import { LegalPage } from './pages/legal-page';
import { SupportPage } from './pages/support';

const languageStorageKey = 'homeypaw-site-language';

function getPage(pathname: string): PageKey {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/privacy') return 'privacy';
  if (path === '/terms') return 'terms';
  if (path === '/support') return 'support';
  return 'home';
}

function getInitialLanguage(): Language {
  const stored = window.localStorage.getItem(languageStorageKey);
  return stored === 'en' || stored === 'zh-HK' ? stored : 'zh-HK';
}

function updateMeta(title: string, description: string, language: Language) {
  document.title = title;
  document.documentElement.lang = language;

  const descriptionMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="description"]',
  );
  const ogTitle = document.querySelector<HTMLMetaElement>(
    'meta[property="og:title"]',
  );
  const ogDescription = document.querySelector<HTMLMetaElement>(
    'meta[property="og:description"]',
  );

  descriptionMeta?.setAttribute('content', description);
  ogTitle?.setAttribute('content', title);
  ogDescription?.setAttribute('content', description);
}

export function App() {
  const [language, setLanguage] = useState<Language>(getInitialLanguage);
  const page = getPage(window.location.pathname);
  const copy = language === 'zh-HK' ? zhHK : en;

  useEffect(() => {
    const meta = copy.meta[page];
    updateMeta(meta.title, meta.description, language);
  }, [copy, language, page]);

  const changeLanguage = (nextLanguage: Language) => {
    window.localStorage.setItem(languageStorageKey, nextLanguage);
    setLanguage(nextLanguage);
  };

  let content;
  if (page === 'privacy') {
    content = <LegalPage {...copy.privacy} />;
  } else if (page === 'terms') {
    content = <LegalPage {...copy.terms} />;
  } else if (page === 'support') {
    content = <SupportPage copy={copy} />;
  } else {
    content = <HomePage copy={copy} />;
  }

  return (
    <div className="site-shell">
      <SiteHeader
        copy={copy}
        language={language}
        onLanguageChange={changeLanguage}
        page={page}
      />
      {content}
      <SiteFooter copy={copy} />
    </div>
  );
}
