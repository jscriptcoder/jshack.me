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

// --- Product data model -----------------------------------------------------

type ProductSpec = {
  readonly label: string;
  readonly value: string;
};

type Product = {
  readonly sku: string;
  readonly displayName: string;
  readonly category: ProductCategory;
  readonly priceUsd: string;
  readonly stock: string;
  readonly specs: readonly ProductSpec[];
  readonly descriptionHtml: string;
  readonly disclaimerHtml: string;
};

type ProductCategory =
  | 'Processors'
  | 'Memory'
  | 'Storage'
  | 'Networking'
  | 'Test Equipment'
  | 'Salvage Lots';

const PRODUCTS: readonly Product[] = [
  {
    sku: 'xeon-e5-2680v4',
    displayName: 'Intel Xeon E5-2680 v4 (Desoldered)',
    category: 'Processors',
    priceUsd: '$89 USD per unit',
    stock: '12 units in stock (per-customer limit: 4)',
    specs: [
      { label: 'Cores / Threads', value: '14C / 28T' },
      { label: 'Base Clock', value: '2.4 GHz' },
      { label: 'Turbo Clock', value: '3.3 GHz' },
      { label: 'Socket', value: 'FCLGA2011-3' },
      { label: 'TDP', value: '120W' },
      { label: 'Source', value: 'Desoldered from Dell PowerEdge R730 servers' },
    ],
    descriptionHtml: `<p>
      Intel Xeon E5-2680 v4 server processors recovered from decommissioned
      Dell PowerEdge R730 chassis. CPUs are removed from sockets, cleaned,
      and inspected. No box, no cooler, no thermal compound included.
    </p>
    <p>
      Pins are inspected at intake but minor bend or surface oxidation may
      be present. A pin-straightening kit is recommended for buyers without
      hot-air rework experience. Functional testing performed via POST in
      reference platform only &mdash; sustained-load and ECC validation is the
      buyer's responsibility.
    </p>`,
    disclaimerHtml: `<p>
      Sold under power-on warranty only. Returns within 24 hours per
      <a href="/shipping.html">Shipping &amp; Payment</a> terms.
    </p>`,
  },
  {
    sku: 'ddr4-32gb-ecc',
    displayName: 'DDR4 32GB ECC Registered (Server Pull)',
    category: 'Memory',
    priceUsd: '$42 USD per module &mdash; $148 USD for a matched 4-stick kit',
    stock: '200+ modules available',
    specs: [
      { label: 'Capacity', value: '32 GB' },
      { label: 'Type', value: 'DDR4 ECC Registered (RDIMM)' },
      { label: 'Speed', value: 'PC4-2400 (2400 MT/s)' },
      { label: 'Form Factor', value: '288-pin' },
      { label: 'Brand', value: 'Mixed: Samsung, Micron, Hynix (matched kits on request)' },
      { label: 'Source', value: 'Server pull, mixed enterprise origins' },
    ],
    descriptionHtml: `<p>
      32GB DDR4 ECC Registered modules pulled from operating servers prior
      to decommissioning. ECC functionality verified by power-on test in
      reference platform.
    </p>
    <p>
      Heat-spreader labels may be partially removed or replaced as part of
      asset-recovery processing &mdash; this does not affect electrical operation.
      Brand mix is the default for single-module orders; brand-matched kits
      are available on request at no additional cost.
    </p>`,
    disclaimerHtml: `<p>
      Tested in burst, not sustained workload. Spike, latency, and refresh
      tolerances are not warranted. Returns within 24 hours per
      <a href="/shipping.html">Shipping &amp; Payment</a> terms.
    </p>`,
  },
  {
    sku: 'samsung-pm981-1tb',
    displayName: 'Samsung PM981 1TB NVMe SSD (Refurbished)',
    category: 'Storage',
    priceUsd: '$35 USD per unit',
    stock: '80 units in stock',
    specs: [
      { label: 'Capacity', value: '1 TB (1,024 GB)' },
      { label: 'Interface', value: 'PCIe 3.0 x4 NVMe' },
      { label: 'Form Factor', value: 'M.2 2280' },
      { label: 'Sequential Read / Write', value: 'Up to 3,000 / 1,800 MB/s (per OEM spec)' },
      { label: 'Source', value: 'OEM enterprise pull' },
    ],
    descriptionHtml: `<p>
      Samsung PM981 OEM enterprise NVMe SSDs. SMART data has been reset per
      OEM resale agreement &mdash; original wear and runtime data is not
      available for review.
    </p>
    <p>
      Capacity is verified at intake. Drive lifespan is not warranted.
      Firmware version may differ from retail-channel variants; compatibility
      with consumer firmware tooling (Samsung Magician, etc.) is not
      guaranteed.
    </p>`,
    disclaimerHtml: `<p>
      Sold as-is for development, lab, or non-critical use. Not recommended
      for production storage roles. Returns within 24 hours per
      <a href="/shipping.html">Shipping &amp; Payment</a> terms.
    </p>`,
  },
  {
    sku: 'cisco-3850-12s',
    displayName: 'Cisco Catalyst 3850-12S Enterprise Switch',
    category: 'Networking',
    priceUsd: '$180 USD per unit',
    stock: '6 units in stock',
    specs: [
      { label: 'Ports', value: '12 &times; 1Gb SFP' },
      {
        label: 'Uplink',
        value: '4 &times; 1Gb / 2 &times; 10Gb (module-dependent, sold separately)',
      },
      { label: 'Stacking', value: 'StackWise-480 ready' },
      { label: 'IOS XE Version', value: '16.12.x (last known good config)' },
      { label: 'Source', value: 'Decommissioned from corporate datacenter' },
    ],
    descriptionHtml: `<p>
      Cisco Catalyst 3850-12S enterprise managed switch, decommissioned from
      a corporate environment. Chassis condition is good; rack-mount ears
      included.
    </p>
    <p>
      Configuration may persist from prior deployment &mdash; factory reset
      is strongly recommended before placing in service. Service contract
      is NOT transferred; software update access through Cisco is not
      included. SFP modules and uplink module are NOT included unless
      specifically listed in the order confirmation.
    </p>`,
    disclaimerHtml: `<p>
      No accessories or cables included. Sold without manufacturer support
      contract. Returns within 24 hours per
      <a href="/shipping.html">Shipping &amp; Payment</a> terms.
    </p>`,
  },
  {
    sku: 'rigol-ds1054z',
    displayName: 'Rigol DS1054Z Oscilloscope (Bandwidth-Unlocked)',
    category: 'Test Equipment',
    priceUsd: '$220 USD per unit',
    stock: '4 units in stock',
    specs: [
      { label: 'Bandwidth', value: '50 MHz (unlocked to 100 MHz via firmware option key)' },
      { label: 'Channels', value: '4' },
      { label: 'Sample Rate', value: '1 GSa/s' },
      { label: 'Memory Depth', value: '24 Mpts' },
      { label: 'Source', value: 'Refurbished from end-of-life lab inventory' },
    ],
    descriptionHtml: `<p>
      Rigol DS1054Z 4-channel digital oscilloscope, refurbished from a
      closed laboratory. Bandwidth is unlocked from the stock 50 MHz to
      100 MHz via firmware option key.
    </p>
    <p>
      Whether the option-key activation persists across future firmware
      updates is at the buyer's risk. Calibration sticker may be expired.
      Cosmetic condition is fair to good; case may show light handling
      marks.
    </p>`,
    disclaimerHtml: `<p>
      Probes NOT included unless specifically listed. Power cord included.
      Sold as-is; no calibration service available through us. Returns
      within 24 hours per <a href="/shipping.html">Shipping &amp; Payment</a>
      terms.
    </p>`,
  },
  {
    sku: 'salvage-mb-aug2024',
    displayName: 'Salvage Lot — Mixed Motherboards (Aug 2024 Recovery)',
    category: 'Salvage Lots',
    priceUsd: '$45 USD per parcel',
    stock: '18 parcels remaining',
    specs: [
      { label: 'Weight', value: '~5 kg per parcel (&plusmn;10%)' },
      { label: 'Estimated Count', value: '8&ndash;15 boards per parcel' },
      { label: 'Form Factors', value: 'Mixed ATX, mATX, ITX, server proprietary' },
      { label: 'Status', value: 'Untested' },
      { label: 'Source', value: 'August 2024 e-waste cleared inventory' },
    ],
    descriptionHtml: `<p>
      Mixed motherboard salvage lot, approximately 5kg per parcel. Boards
      have been visually inspected for major damage and physical
      completeness but have NOT been functionally tested.
    </p>
    <p>
      Typical contents are a blend of working, partially working, and
      defective units in roughly equal measure &mdash; your mileage will
      vary. Photos of a representative parcel are available on request
      before shipment; specific parcel contents are not pre-photographed.
    </p>`,
    disclaimerHtml: `<p>
      Sold strictly as-is. No returns. Buyer assumes all risk regarding
      component condition. The 24-hour return window described in
      <a href="/shipping.html">Shipping &amp; Payment</a> does NOT apply to
      salvage lots.
    </p>`,
  },
];

// --- Page renderers ---------------------------------------------------------

const renderSpecRow = (s: ProductSpec): string =>
  `<tr><th scope="row">${s.label}</th><td>${s.value}</td></tr>`;

const renderProductBody = (p: Product): string => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${p.displayName} &mdash; TechParts Global</title>
  </head>
  <body>
    ${NAV_HTML}

    <p><a href="/catalog.html">&larr; Back to Catalog</a></p>

    <h1>${p.displayName}</h1>
    <p><strong>Category:</strong> ${p.category}</p>

    <h2>Specifications</h2>
    <table>
      <tbody>
        ${p.specs.map(renderSpecRow).join('\n        ')}
      </tbody>
    </table>

    <h2>Description</h2>
    ${p.descriptionHtml}

    <h2>Pricing &amp; Availability</h2>
    <p><strong>Price:</strong> ${p.priceUsd}</p>
    <p><strong>Stock:</strong> ${p.stock}</p>
    <p><em>Limited stock. Pricing subject to change without notice. Crypto and wire transfer accepted &mdash; see <a href="/shipping.html">Shipping &amp; Payment</a>.</em></p>

    <h2>Terms</h2>
    ${p.disclaimerHtml}

    ${SUBPAGE_FOOTER_HTML}
  </body>
</html>
`;

const productPage = (p: Product): TechpartsPage => ({
  path: `/products/${p.sku}.html`,
  title: `${p.displayName} — TechParts Global`,
  body: renderProductBody(p),
  kind: 'html',
  visibility: 'linked',
});

const PRODUCT_PAGES: readonly TechpartsPage[] = PRODUCTS.map(productPage);

// --- Catalog page (driven by PRODUCTS) --------------------------------------

const CATEGORY_BLURBS: Readonly<Record<ProductCategory, string>> = {
  Processors:
    'OEM CPUs, desoldered server modules, engineering samples. Tested to power-on; full functionality not guaranteed without separate validation.',
  Memory:
    'DDR3, DDR4, and DDR5 modules. Pulled from decommissioned servers and refurbished workstations. Labels may not match original branding.',
  Storage:
    'SSDs, HDDs, and enterprise NVMe drives at salvage prices. SMART data may have been reset. Sold with prior wear; capacity verified, lifespan not.',
  Networking:
    'Decommissioned enterprise routers, switches, and access points. Configuration may persist from previous deployments &mdash; factory-reset recommended.',
  'Test Equipment':
    'Oscilloscopes, multimeters, spectrum analyzers. Calibration as-is. Sold under power-on warranty only.',
  'Salvage Lots':
    'Mystery boxes from cleared inventory. Contents vary. Photos available on request. Not returnable.',
};

const CATEGORIES_IN_ORDER: readonly ProductCategory[] = [
  'Processors',
  'Memory',
  'Storage',
  'Networking',
  'Test Equipment',
  'Salvage Lots',
];

const renderCatalogCategory = (cat: ProductCategory): string => {
  const items = PRODUCTS.filter((p) => p.category === cat);
  const listHtml =
    items.length === 0
      ? '<p><em>No items currently listed in this category.</em></p>'
      : `<ul>
          ${items
            .map((p) => `<li><a href="/products/${p.sku}.html">${p.displayName}</a></li>`)
            .join('\n          ')}
        </ul>`;
  return `<section>
      <h2>${cat}</h2>
      <p>${CATEGORY_BLURBS[cat]}</p>
      ${listHtml}
    </section>`;
};

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

    ${CATEGORIES_IN_ORDER.map(renderCatalogCategory).join('\n\n    ')}

    ${SUBPAGE_FOOTER_HTML}
  </body>
</html>
`;

// --- Other pages ------------------------------------------------------------

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
    <p>See our <a href="/shipping.html">Shipping &amp; Payment</a> page for full terms. In summary: returns accepted within 24 hours of delivery, customer pays return shipping, 30% restocking fee, refunds issued as store credit.</p>

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

// --- Hidden / gobuster-only pages -------------------------------------------
//
// These paths are NOT linked from any page in the public nav — players
// discover them via robots.txt, gobuster, or recon of /backup/ + /uploads/
// directory listings. The "no linked page references hidden path" test
// guards the gobuster-only quality.

const ADMIN_BODY = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Admin Login — TechParts Global</title>
  </head>
  <body>
    <h1>Administrative Access</h1>
    <p>Restricted area. Authorized personnel only. Unauthorized access attempts are logged.</p>

    <form method="POST" action="/admin">
      <p>
        <label>Username<br>
          <input type="text" name="username" autocomplete="off" required>
        </label>
      </p>
      <p>
        <label>Password<br>
          <input type="password" name="password" autocomplete="off" required>
        </label>
      </p>
      <p>
        <button type="submit">Sign In</button>
      </p>
    </form>

    <hr>
    <p><small>TechParts Global Admin Console &middot; v3.4.2</small></p>
  </body>
</html>
`;

const BACKUP_BODY = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Index of /backup</title>
  </head>
  <body>
    <h1>Index of /backup</h1>
    <table>
      <thead>
        <tr><th>Name</th><th>Last Modified</th><th>Size</th><th>Description</th></tr>
      </thead>
      <tbody>
        <tr><td><a href="/">[Parent Directory]</a></td><td>-</td><td>-</td><td>-</td></tr>
        <tr><td>db_2024-08-15.sql.bak</td><td>2024-08-15 03:12</td><td>847M</td><td>Pre-deployment DB snapshot</td></tr>
        <tr><td>orders_2024Q3.csv</td><td>2024-10-02 23:48</td><td>14M</td><td>Q3 orders export</td></tr>
        <tr><td>customers_2024.csv</td><td>2024-12-31 17:00</td><td>22M</td><td>Annual customer export</td></tr>
        <tr><td>config_old.tar.gz</td><td>2024-06-19 09:30</td><td>3.2M</td><td>Legacy config archive</td></tr>
        <tr><td>migration_notes.txt</td><td>2024-09-04 14:17</td><td>4.1K</td><td>Migration runbook</td></tr>
      </tbody>
    </table>
    <hr>
    <p><small>Apache Server at techparts.io Port 80</small></p>
  </body>
</html>
`;

const UPLOADS_BODY = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Index of /uploads</title>
  </head>
  <body>
    <h1>Index of /uploads</h1>
    <table>
      <thead>
        <tr><th>Name</th><th>Last Modified</th><th>Size</th><th>Description</th></tr>
      </thead>
      <tbody>
        <tr><td><a href="/">[Parent Directory]</a></td><td>-</td><td>-</td><td>-</td></tr>
        <tr><td>invoice_INV-9412.pdf</td><td>2024-11-22 16:05</td><td>184K</td><td>-</td></tr>
        <tr><td>shipment_label_DHL.png</td><td>2024-11-23 09:15</td><td>62K</td><td>-</td></tr>
        <tr><td>cert_iso9001_2019.jpg</td><td>2019-04-08 11:00</td><td>388K</td><td>-</td></tr>
        <tr><td>price_sheet_internal.xlsx</td><td>2024-08-30 18:42</td><td>96K</td><td>-</td></tr>
        <tr><td>warehouse_photo.jpg</td><td>2023-02-14 12:00</td><td>1.4M</td><td>-</td></tr>
        <tr><td>thumbs.db</td><td>2024-12-01 04:00</td><td>22K</td><td>-</td></tr>
      </tbody>
    </table>
    <hr>
    <p><small>Apache Server at techparts.io Port 80</small></p>
  </body>
</html>
`;

const ROBOTS_TXT = `User-agent: *
Disallow: /admin
Disallow: /backup
Disallow: /uploads
Disallow: /staff-notes.txt
Disallow: /.env.bak
Disallow: /changelog.txt

# Internal: please do not crawl admin or staff areas.
# Indexing exceptions: contact webmaster@techparts.io
`;

const STAFF_NOTES_TXT = `TechParts ops notes - keep in sync with #ops channel
=====================================================

* db backup script firing nightly @ 03:00 UTC, output in /backup/
* admin creds rotated quarterly per policy
   ! last rotation: 2024-Q2 (overdue, blocked on prod-window approval)
   ! TODO: rotate after migration freeze lifts
* monero wallet seed in 1pass vault "ops-prod"
* SFTP key for fulfillment partner expires 2025-04-12
   - renew at least 7 days prior
* watch dashboard for price-arbitrage alerts (auto-pause buyers)
   - playbook in /uploads/ (link to PDF; check if v3 is still current)
* known issue: cron sometimes double-fires the customer export
   ! workaround: dedupe on order_id in target s3
   ! root cause: cron drift, low priority
* DON'T touch the legacy reporting box, scheduled for retirement Q1 2025

Reminders:
- if you're reading this and you don't recognize the file, you shouldn't be here.
- escalate to ops lead, not engineering.
`;

const ENV_BAK = `# Production environment - DO NOT COMMIT
# Backed up 2024-09-04 before migration

NODE_ENV=production
APP_HOST=techparts.io
APP_PORT=8080

# Database
DB_HOST=10.4.2.18
DB_PORT=5432
DB_NAME=techparts_prod
DB_USER=tp_app
DB_PASSWORD=Glob4lP4rts!Spring24

# Cache
REDIS_HOST=10.4.2.22
REDIS_PORT=6379
REDIS_PASSWORD=cacheR3disS3cret

# Email
SMTP_HOST=smtp.mailgun.org
SMTP_USER=postmaster@mg.techparts.io
SMTP_PASSWORD=mg_pubkey_redacted_in_backup

# Admin console (legacy, see migration_notes.txt for new flow)
ADMIN_USERNAME=admin
ADMIN_DEFAULT_PASSWORD=ChangeMe123!

# Payment processors
BTC_WALLET_RECEIVE=bc1qfaketestaddressdonotuse
MONERO_WALLET_VIEW_KEY=redacted_check_1pass
WIRE_TRANSFER_BANK_REF=offshore-banking-partner-internal
`;

const CHANGELOG_TXT = `TechParts Global - internal changelog
=====================================
(public-facing changes only; ops/infra changes in ops repo)

2024-12-18 - bump nav: contact link visible on faq
2024-12-04 - faq: tighten "warehouse visit" answer (kept "No.")
2024-11-19 - shipping: clarify customs liability for non-EU
2024-11-09 - catalog: add salvage lot category (was: hidden cat)
2024-10-31 - HOTFIX: admin login lockout after 3rd attempt removed
   - reasoning: ops was getting locked out daily
   - TODO: re-implement with longer window once we have monitoring
2024-10-15 - re-priced cisco 3850-12s (-15% to clear stock)
2024-09-30 - sales: add monero as preferred method
2024-09-04 - backed up .env before deploy migration
2024-08-12 - new salvage lot listed (aug-recovery)
2024-07-22 - faq Q reorder: pricing answer moved down
2024-07-08 - REVERT: remove "BBB accredited" badge (we are not)
2024-06-19 - archive legacy config to /backup/
2024-05-30 - landing copy: add "no questions asked" line
2024-05-12 - new vendor onboarding (xeon e5 desolder batch incoming)
2024-04-04 - blog removed (was empty for 6 months)
2024-03-15 - admin console upgraded to v3.4.2
2024-02-28 - initial site relaunch
`;

const ADMIN_PAGE: TechpartsPage = {
  path: '/admin',
  title: 'Admin Login — TechParts Global',
  body: ADMIN_BODY,
  kind: 'html',
  visibility: 'hidden',
};

const BACKUP_PAGE: TechpartsPage = {
  path: '/backup',
  title: 'Index of /backup',
  body: BACKUP_BODY,
  kind: 'html',
  visibility: 'hidden',
};

const UPLOADS_PAGE: TechpartsPage = {
  path: '/uploads',
  title: 'Index of /uploads',
  body: UPLOADS_BODY,
  kind: 'html',
  visibility: 'hidden',
};

const ROBOTS_PAGE: TechpartsPage = {
  path: '/robots.txt',
  title: 'robots.txt',
  body: ROBOTS_TXT,
  kind: 'text',
  visibility: 'hidden',
};

const STAFF_NOTES_PAGE: TechpartsPage = {
  path: '/staff-notes.txt',
  title: 'staff-notes.txt',
  body: STAFF_NOTES_TXT,
  kind: 'text',
  visibility: 'hidden',
};

const ENV_BAK_PAGE: TechpartsPage = {
  path: '/.env.bak',
  title: '.env.bak',
  body: ENV_BAK,
  kind: 'text',
  visibility: 'hidden',
};

const CHANGELOG_PAGE: TechpartsPage = {
  path: '/changelog.txt',
  title: 'changelog.txt',
  body: CHANGELOG_TXT,
  kind: 'text',
  visibility: 'hidden',
};

// --- Manifest ---------------------------------------------------------------

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
  ...PRODUCT_PAGES,
  ADMIN_PAGE,
  BACKUP_PAGE,
  UPLOADS_PAGE,
  ROBOTS_PAGE,
  STAFF_NOTES_PAGE,
  ENV_BAK_PAGE,
  CHANGELOG_PAGE,
];

export const LINKED_PAGES: readonly TechpartsPage[] = TECHPARTS_PAGES.filter(
  (p) => p.visibility === 'linked',
);

export const HIDDEN_PAGES: readonly TechpartsPage[] = TECHPARTS_PAGES.filter(
  (p) => p.visibility === 'hidden',
);
