import type { SiteCopy } from '../i18n/types';

export function HomePage({ copy }: { copy: SiteCopy }) {
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{copy.home.eyebrow}</p>
          <h1>{copy.home.title}</h1>
          <p className="intro">{copy.home.intro}</p>
          <div className="hero-actions">
            <a className="primary-action" href="/privacy">
              {copy.home.primaryAction}
            </a>
            <a className="text-action" href="/support">
              {copy.home.secondaryAction}
            </a>
            <span>{copy.home.status}</span>
          </div>
        </div>
        <div className="memory-card" aria-label={copy.home.cardTitle}>
          <span className="card-date">{copy.home.cardDate}</span>
          <div className="pet-mark">
            <img src="/homeypaw-mark.png" alt="" />
          </div>
          <strong>{copy.home.cardTitle}</strong>
          <p>{copy.home.cardBody}</p>
        </div>
      </section>

      <section className="features" aria-labelledby="features-title">
        <div className="section-heading">
          <p className="eyebrow">{copy.home.featureEyebrow}</p>
          <h2 id="features-title">{copy.home.featureTitle}</h2>
        </div>
        <div className="feature-grid">
          {copy.home.features.map((feature, index) => (
            <article key={feature.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trust-section">
        <div>
          <p className="eyebrow">{copy.home.legalEyebrow}</p>
          <h2>{copy.home.legalTitle}</h2>
        </div>
        <div>
          <p>{copy.home.legalBody}</p>
          <div className="trust-links">
            <a href="/privacy">{copy.nav.privacy}</a>
            <a href="/terms">{copy.nav.terms}</a>
            <a href="/support">{copy.nav.support}</a>
          </div>
        </div>
      </section>
    </main>
  );
}
