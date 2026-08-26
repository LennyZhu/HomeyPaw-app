export type Language = 'zh-HK' | 'en';
export type PageKey = 'home' | 'privacy' | 'terms' | 'support';

export type LegalSection = {
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

export type SiteCopy = {
  meta: Record<PageKey, { title: string; description: string }>;
  nav: Record<PageKey, string>;
  languageButton: string;
  home: {
    eyebrow: string;
    title: string;
    intro: string;
    primaryAction: string;
    secondaryAction: string;
    status: string;
    cardDate: string;
    cardTitle: string;
    cardBody: string;
    featureEyebrow: string;
    featureTitle: string;
    features: Array<{ title: string; body: string }>;
    legalEyebrow: string;
    legalTitle: string;
    legalBody: string;
  };
  privacy: {
    eyebrow: string;
    title: string;
    intro: string;
    sections: LegalSection[];
    lastUpdated: string;
  };
  terms: {
    eyebrow: string;
    title: string;
    intro: string;
    sections: LegalSection[];
    lastUpdated: string;
  };
  support: {
    eyebrow: string;
    title: string;
    intro: string;
    issuesTitle: string;
    issues: string[];
    emailLabel: string;
    emailAction: string;
    response: string;
    detailsTitle: string;
    details: Array<{ label: string; value: string }>;
  };
  footer: {
    tagline: string;
    copyright: string;
  };
};
