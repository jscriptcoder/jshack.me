// Hand-authored content manifest for techparts.io — sketchy gray-market
// electronics reseller. Pages are flat data: the generator lays each
// entry into /var/www/html<path> verbatim, the curl pipeline serves it,
// and the upcoming terminal-browser command renders kind: 'html' pages
// via the host browser's HTML parser. Plain-text artefacts (robots.txt,
// *.txt, *.bak) carry kind: 'text' and are served as-is.
//
// Authoring rules — see project_themed_network_html_validity:
//   - kind: 'html' pages MUST be well-formed semantic HTML.
//   - No <script>, <style>, class=, id= — the terminal browser has
//     no CSS or JS surface, and those attributes would smuggle layout
//     concerns into a frame that can't honour them.
//   - Internal <a href> values MUST point at a manifest path. The
//     link-integrity test guards this.

export type TechpartsPage = {
  readonly path: string;
  readonly title: string;
  readonly body: string;
  readonly kind: 'html' | 'text';
  readonly visibility: 'linked' | 'hidden';
};

const LANDING_TITLE = 'TechParts Global — Worldwide Electronic Components';

const LANDING_BODY = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${LANDING_TITLE}</title>
  </head>
  <body>
    <header>
      <h1>TechParts Global</h1>
      <p><em>Genuine* electronic components. Factory-direct pricing. Worldwide shipping.</em></p>
    </header>

    <section>
      <h2>Why TechParts Global?</h2>
      <ul>
        <li>Direct relationships with OEM factories &mdash; no middleman markup.</li>
        <li>Engineering samples, refurbished modules, salvage lots in stock.</li>
        <li>Fast worldwide shipping. Crypto and wire transfer accepted.</li>
        <li>No questions asked.</li>
      </ul>
    </section>

    <section>
      <h2>Trusted Worldwide</h2>
      <p>Member of the International Electronic Trade Association**</p>
      <p>ISO-9001 compliant*** &middot; Quality guaranteed****</p>
    </section>

    <footer>
      <hr>
      <p>
        <small>
          * Components sourced from a variety of channels. Authenticity may vary.
          ** Membership application under review since 2019.
          *** Self-certified.
          **** "Guaranteed" subject to terms in shipping contract upon delivery acceptance.
          Returns accepted within 24 hours of delivery; customer pays return shipping plus
          a 30% restocking fee. Refunds issued as store credit. By browsing this site you
          agree to our terms of service.
        </small>
      </p>
      <p><small>&copy; TechParts Global. All rights reserved.</small></p>
    </footer>
  </body>
</html>
`;

const LANDING_PAGE: TechpartsPage = {
  path: '/',
  title: LANDING_TITLE,
  body: LANDING_BODY,
  kind: 'html',
  visibility: 'linked',
};

export const TECHPARTS_PAGES: readonly TechpartsPage[] = [LANDING_PAGE];

export const LINKED_PAGES: readonly TechpartsPage[] = TECHPARTS_PAGES.filter(
  (p) => p.visibility === 'linked',
);

export const HIDDEN_PAGES: readonly TechpartsPage[] = TECHPARTS_PAGES.filter(
  (p) => p.visibility === 'hidden',
);
