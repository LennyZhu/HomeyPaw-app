import type { LegalSection } from '../i18n/types';

type LegalPageProps = {
  eyebrow: string;
  intro: string;
  lastUpdated: string;
  sections: LegalSection[];
  title: string;
};

export function LegalPage({
  eyebrow,
  intro,
  lastUpdated,
  sections,
  title,
}: LegalPageProps) {
  return (
    <main className="document-page">
      <header className="document-hero">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{intro}</p>
        <span>{lastUpdated}</span>
      </header>
      <div className="document-layout">
        <aside aria-label="Document sections">
          <span>HomeyPaw</span>
          <strong>{title}</strong>
          <a href="mailto:lenny996@163.com">lenny996@163.com</a>
        </aside>
        <article className="legal-content">
          {sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.bullets ? (
                <ul>
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
          <p className="last-updated">{lastUpdated}</p>
        </article>
      </div>
    </main>
  );
}
