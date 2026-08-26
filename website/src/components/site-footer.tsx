import type { SiteCopy } from '../i18n/types';

export function SiteFooter({ copy }: { copy: SiteCopy }) {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <img src="/homeypaw-mark.png" alt="" />
        <div>
          <strong>HomeyPaw</strong>
          <p>{copy.footer.tagline}</p>
        </div>
      </div>
      <nav aria-label="Footer">
        <a href="/privacy">{copy.nav.privacy}</a>
        <a href="/terms">{copy.nav.terms}</a>
        <a href="/support">{copy.nav.support}</a>
      </nav>
      <p className="copyright">{copy.footer.copyright}</p>
    </footer>
  );
}
