import type { SiteCopy } from '../i18n/types';

const supportEmail = 'lenny996@163.com';

export function SupportPage({ copy }: { copy: SiteCopy }) {
  return (
    <main className="support-page">
      <section className="support-hero">
        <div>
          <p className="eyebrow">{copy.support.eyebrow}</p>
          <h1>{copy.support.title}</h1>
          <p>{copy.support.intro}</p>
        </div>
        <div className="support-email-card">
          <span>{copy.support.emailLabel}</span>
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
          <a
            className="primary-action"
            href={`mailto:${supportEmail}?subject=HomeyPaw%20Support`}
          >
            {copy.support.emailAction}
          </a>
          <p>{copy.support.response}</p>
        </div>
      </section>

      <section className="support-grid">
        <article>
          <h2>{copy.support.issuesTitle}</h2>
          <ul className="issue-list">
            {copy.support.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </article>
        <article>
          <h2>{copy.support.detailsTitle}</h2>
          <dl>
            {copy.support.details.map((detail) => (
              <div key={detail.label}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        </article>
      </section>
    </main>
  );
}
