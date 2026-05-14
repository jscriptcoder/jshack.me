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

// Shared nav rendered on every linked page so players can move between
// sections without juggling URLs. Sub-pages also rely on it for the
// back-to-home link verified by the public-page-set tests.
const NAV_HTML = `<nav>
      <a href="/">Home</a> |
      <a href="/catalog.html">Catalog</a> |
      <a href="/about.html">About</a> |
      <a href="/shipping.html">Shipping &amp; Payment</a> |
      <a href="/contact.html">Contact</a> |
      <a href="/faq.html">FAQ</a>
    </nav>`;

// Lite footer used on sub-pages. The landing page ships its own heavier
// footer with the asterisk-laden disclaimer block, so it doesn't share
// this one.
const SUBPAGE_FOOTER_HTML = `<footer>
      <hr>
      <p><small>&copy; TechParts Global. Components sourced from a variety of channels.</small></p>
    </footer>`;

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

    ${NAV_HTML}

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

const CATALOG_TITLE = 'Catalog — TechParts Global';

const CATALOG_BODY = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${CATALOG_TITLE}</title>
  </head>
  <body>
    ${NAV_HTML}

    <h1>Catalog</h1>
    <p>Browse our worldwide inventory by category. Stock rotates frequently &mdash; check back for new arrivals.</p>

    <section>
      <h2>Processors</h2>
      <p>OEM CPUs, desoldered server modules, engineering samples. Tested to power-on; full functionality not guaranteed without separate validation.</p>
    </section>

    <section>
      <h2>Memory</h2>
      <p>DDR3, DDR4, and DDR5 modules. Pulled from decommissioned servers and refurbished workstations. Labels may not match original branding.</p>
    </section>

    <section>
      <h2>Storage</h2>
      <p>SSDs, HDDs, and enterprise NVMe drives at salvage prices. SMART data may have been reset. Sold with prior wear; capacity verified, lifespan not.</p>
    </section>

    <section>
      <h2>Networking</h2>
      <p>Decommissioned enterprise routers, switches, and access points. Configuration may persist from previous deployments &mdash; factory-reset recommended.</p>
    </section>

    <section>
      <h2>Test Equipment</h2>
      <p>Oscilloscopes, multimeters, spectrum analyzers. Calibration as-is. Sold under power-on warranty only.</p>
    </section>

    <section>
      <h2>Salvage Lots</h2>
      <p>Mystery boxes from cleared inventory. Contents vary. Photos available on request. Not returnable.</p>
    </section>

    ${SUBPAGE_FOOTER_HTML}
  </body>
</html>
`;

const ABOUT_TITLE = 'About — TechParts Global';

const ABOUT_BODY = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${ABOUT_TITLE}</title>
  </head>
  <body>
    ${NAV_HTML}

    <h1>About TechParts Global</h1>

    <p>
      TechParts Global was founded in 2019 by a group of industry veterans with decades of
      combined experience in electronic component sourcing, distribution, and asset recovery.
      We connect surplus inventory from manufacturers, decommissioned data centers, and
      authorized recycling channels directly to engineers, integrators, and procurement teams
      worldwide.
    </p>

    <h2>Operations</h2>
    <p>
      We operate from facilities in multiple jurisdictions to serve our global customer base
      and maintain resilient supply lines. Order fulfillment is routed dynamically based on
      stock availability and destination &mdash; this is why shipping origins vary order to order.
    </p>

    <h2>Sourcing</h2>
    <p>
      Our network includes OEM partners, contract manufacturers, refurbishment facilities,
      and certified e-waste processors. We do not disclose specific supplier relationships
      to protect commercial agreements. Component provenance can be discussed on a per-order
      basis for qualified buyers.
    </p>

    <h2>Leadership</h2>
    <p>
      TechParts Global is privately held. Our leadership team prefers to let our pricing and
      catalog speak for themselves rather than chase publicity. Inquiries from the press are
      not answered.
    </p>

    ${SUBPAGE_FOOTER_HTML}
  </body>
</html>
`;

const SHIPPING_TITLE = 'Shipping & Payment — TechParts Global';

const SHIPPING_BODY = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${SHIPPING_TITLE}</title>
  </head>
  <body>
    ${NAV_HTML}

    <h1>Shipping &amp; Payment</h1>

    <h2>Accepted Payment Methods</h2>
    <table>
      <thead>
        <tr><th>Method</th><th>Processing</th><th>Notes</th></tr>
      </thead>
      <tbody>
        <tr><td>Bitcoin (BTC)</td><td>Immediate on confirmation</td><td>Preferred. 2 confirmations required.</td></tr>
        <tr><td>Monero (XMR)</td><td>Immediate on confirmation</td><td>Preferred. 10 confirmations required.</td></tr>
        <tr><td>Ethereum (ETH)</td><td>Immediate</td><td>USDT on ETH also accepted.</td></tr>
        <tr><td>Wire Transfer</td><td>1&ndash;3 business days</td><td>SWIFT or SEPA. Bank details provided after order.</td></tr>
        <tr><td>Money Order</td><td>5&ndash;10 business days</td><td>Mailed to forwarding address. Tracking optional.</td></tr>
      </tbody>
    </table>

    <h2>Shipping Options</h2>
    <table>
      <thead>
        <tr><th>Service</th><th>Estimated Transit</th><th>Tracking</th></tr>
      </thead>
      <tbody>
        <tr><td>Standard</td><td>14&ndash;30 days</td><td>On request</td></tr>
        <tr><td>Express</td><td>7&ndash;14 days</td><td>Included</td></tr>
        <tr><td>Priority</td><td>3&ndash;7 days</td><td>Included; signature optional</td></tr>
      </tbody>
    </table>

    <h2>Important</h2>
    <ul>
      <li>Customs duties, tariffs, and import taxes are the buyer's responsibility.</li>
      <li>We do not insure shipments by default. Insurance available on request at additional cost.</li>
      <li>Refused or returned-to-sender packages forfeit shipping costs and incur a restocking fee.</li>
      <li>Estimated transit times are not guaranteed. Delays due to customs are excluded from any guarantee.</li>
    </ul>

    ${SUBPAGE_FOOTER_HTML}
  </body>
</html>
`;

const CONTACT_TITLE = 'Contact — TechParts Global';

const CONTACT_BODY = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${CONTACT_TITLE}</title>
  </head>
  <body>
    ${NAV_HTML}

    <h1>Contact Us</h1>

    <p>
      Sales and general inquiries: <a href="mailto:sales@techparts.io">sales@techparts.io</a>.
      Responses within 1&ndash;3 business days. We do not provide phone support.
    </p>

    <p>For order-specific questions, please include your order reference in the subject line.</p>

    <h2>Quick Inquiry</h2>
    <form method="POST">
      <p>
        <label>Email<br>
          <input type="email" name="email" required>
        </label>
      </p>
      <p>
        <label>Subject<br>
          <input type="text" name="subject" required>
        </label>
      </p>
      <p>
        <label>Message<br>
          <textarea name="message" rows="6" cols="60" required></textarea>
        </label>
      </p>
      <p>
        <button type="submit">Send Inquiry</button>
      </p>
    </form>

    <p><small>By submitting this form you consent to your message being stored and reviewed for quality assurance.</small></p>

    ${SUBPAGE_FOOTER_HTML}
  </body>
</html>
`;

const FAQ_TITLE = 'FAQ — TechParts Global';

const FAQ_BODY = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${FAQ_TITLE}</title>
  </head>
  <body>
    ${NAV_HTML}

    <h1>Frequently Asked Questions</h1>

    <h2>Are your components authentic?</h2>
    <p>All products meet manufacturer specifications. Provenance varies by sourcing channel and can be discussed per-order for qualified buyers.</p>

    <h2>What's your return policy?</h2>
    <p>See our Shipping &amp; Payment page for full terms. In summary: returns accepted within 24 hours of delivery, customer pays return shipping, 30% restocking fee, refunds issued as store credit.</p>

    <h2>Can I get an invoice for my order?</h2>
    <p>Payment confirmation serves as your invoice. Formal commercial invoices are available on request for an additional administrative fee.</p>

    <h2>Why does the shipping origin change between orders?</h2>
    <p>We fulfill from whichever facility has stock and the most favorable routing to your destination. Origin labels are not a quality indicator.</p>

    <h2>Do you ship to my country?</h2>
    <p>We ship worldwide. Some destinations require additional documentation, paid upfront. Restrictions apply where prohibited by local export controls.</p>

    <h2>Why is your pricing lower than authorized distributors?</h2>
    <p>We work outside the conventional distribution network. By cutting out middlemen and operating leanly, we pass savings directly to you.</p>

    <h2>Can I visit your warehouse?</h2>
    <p>No.</p>

    ${SUBPAGE_FOOTER_HTML}
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

const CATALOG_PAGE: TechpartsPage = {
  path: '/catalog.html',
  title: CATALOG_TITLE,
  body: CATALOG_BODY,
  kind: 'html',
  visibility: 'linked',
};

const ABOUT_PAGE: TechpartsPage = {
  path: '/about.html',
  title: ABOUT_TITLE,
  body: ABOUT_BODY,
  kind: 'html',
  visibility: 'linked',
};

const SHIPPING_PAGE: TechpartsPage = {
  path: '/shipping.html',
  title: SHIPPING_TITLE,
  body: SHIPPING_BODY,
  kind: 'html',
  visibility: 'linked',
};

const CONTACT_PAGE: TechpartsPage = {
  path: '/contact.html',
  title: CONTACT_TITLE,
  body: CONTACT_BODY,
  kind: 'html',
  visibility: 'linked',
};

const FAQ_PAGE: TechpartsPage = {
  path: '/faq.html',
  title: FAQ_TITLE,
  body: FAQ_BODY,
  kind: 'html',
  visibility: 'linked',
};

export const TECHPARTS_PAGES: readonly TechpartsPage[] = [
  LANDING_PAGE,
  CATALOG_PAGE,
  ABOUT_PAGE,
  SHIPPING_PAGE,
  CONTACT_PAGE,
  FAQ_PAGE,
];

export const LINKED_PAGES: readonly TechpartsPage[] = TECHPARTS_PAGES.filter(
  (p) => p.visibility === 'linked',
);

export const HIDDEN_PAGES: readonly TechpartsPage[] = TECHPARTS_PAGES.filter(
  (p) => p.visibility === 'hidden',
);
