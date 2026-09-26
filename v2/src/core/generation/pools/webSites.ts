/**
 * The pages a web server's public site is built from, keyed by the kind of place the
 * network is.
 *
 * A site is somewhere before it is anything else: a café's menu and opening hours, a
 * company's services, a department's courses. So the pages a box publishes are drawn
 * for the place its network belongs to, and the words on them name that place rather
 * than a product. Pages every kind of place keeps — about, contact, news — are shared,
 * and read as their place through the slots they fill.
 *
 * Every page is static data with slots (`{site}`, `{place}`, `{domain}`, `{hostname}`),
 * filled per box. Nothing here links anything: which pages a site holds is drawn per
 * box, so the navigation that links them is written by the builder that knows.
 *
 * Deliberately absent, everywhere: a software version (it dates a box, and only the
 * package manifest states one), a decimal price (it reads as one), a login name (a web
 * tree is readable with no session at all, and the only account a door may be handed
 * is root), and any date after the world began.
 */

import type { NetworkCategory } from './essidCatalog';

export type SitePage = {
  /** The file it is published as, beneath the document root. */
  readonly file: string;
  /** Its heading, and its entry in the site's navigation. */
  readonly title: string;
  /** Alternative bodies, one drawn per box, as HTML fragments with slots. */
  readonly bodies: readonly string[];
};

/** How an institution that publishes to the world describes itself in its homepage's
 *  `<meta name="description">` — the line a search engine shows under its title, and
 *  the words beyond its name that a search can find it by. Only the kinds of place that
 *  publish a site have one. */
export const SITE_DESCRIPTIONS: Readonly<Partial<Record<NetworkCategory, string>>> = {
  corporate: '{site}: products, services, careers and news from the company.',
  cafe: '{site}: coffee, food, opening hours and free wifi for customers.',
  university: '{site}: admissions, courses, research and campus life.',
  public: '{site}: opening hours, services and visitor information for the people of Ridgemont.',
};

/** What a site says on its front page, by kind of place. One is drawn per box. */
export const FRONT_PAGES: Readonly<Record<NetworkCategory, readonly string[]>> = {
  corporate: [
    '<p>{site} builds and runs the systems its clients rely on every day.</p>\n<p>Browse our services, meet the team, or get in touch below.</p>',
    '<p>Welcome to {site}. We have been delivering for our clients since before most of them had a website.</p>\n<p>Quarterly results are published under News.</p>',
    '<p>{site} — trusted by partners across three continents.</p>\n<p>Existing customers: support requests go to the helpdesk, not to your account manager.</p>',
    '<p>This is the public site of {site}. Staff looking for the intranet should use the internal address.</p>',
  ],
  cafe: [
    '<p>Welcome to {site}! Fresh coffee, homemade cakes and free Wi-Fi for customers.</p>\n<p>See the menu and our opening hours below.</p>',
    '<p>{site} — good coffee, slow mornings, fast Wi-Fi.</p>\n<p>Ask at the counter for the network password.</p>',
    '<p>Breakfast until eleven, lunch until three, coffee until we close.</p>\n<p>Everything on the menu is made here at {site}.</p>',
    '<p>A small place with big mugs. {site} has been pouring since the old owners left the espresso machine behind.</p>',
  ],
  residential: [
    '<p>Hi, and welcome to the little site I run from {place}.</p>\n<p>Mostly posts, some links, and the odd recipe.</p>',
    '<p>This server lives in a cupboard at {place}. It hosts this page and not much else.</p>',
    '<p>Family homepage. Photos are on the shared drive, not here — ask if you need the link.</p>',
    '<p>You found my corner of the internet. It is very quiet here.</p>',
  ],
  university: [
    '<p>{site} — teaching, research and the occasional seminar with free biscuits.</p>\n<p>Current students: timetables are under Courses.</p>',
    '<p>Welcome to the pages of {site}. Office hours are posted on the door and, eventually, here.</p>',
    '<p>{site} hosts courses, research groups and a reading room open to all students.</p>',
    '<p>News, courses and people at {site}. Pages are maintained by the department office.</p>',
  ],
  public: [
    '<p>Welcome to {site}. Find opening hours, notices and upcoming events below.</p>',
    '<p>{site} is open to everyone. Free Wi-Fi is available during opening hours.</p>',
    '<p>Service notices for {site} are posted here first, then on the board at the entrance.</p>',
    '<p>Information for visitors to {site}: opening hours, accessibility and how to reach us.</p>',
  ],
  iot: [
    '<p>Home automation hub for {place}. Everything here is on the local network only.</p>',
    '<p>Device dashboard — {place}. Readings refresh every few minutes.</p>',
    '<p>{site} control panel. If a device shows offline, power-cycle it before calling anyone.</p>',
    '<p>Local status page for the devices at {place}. Nothing on this page leaves the house.</p>',
  ],
  hacker: [
    '<p>{site}: a room full of people who take things apart to see how they work.</p>\n<p>Open night is Thursday. Bring a project or bring snacks.</p>',
    '<p>Welcome to {site}. We build, break, solder and occasionally sleep.</p>',
    '<p>{site} runs on donations, spare parts and stubbornness.</p>',
    '<p>Projects, meetups and the wiki for {site}. Be excellent to each other.</p>',
  ],
};

/** Pages every kind of place keeps, reading as their place through their slots. */
export const SHARED_PAGES: readonly SitePage[] = [
  {
    file: 'about.html',
    title: 'About',
    bodies: [
      '<p>{site} started small and stayed that way on purpose.</p>\n<p>We are based at {place}, and this site is run from a machine in the back room.</p>',
      '<p>About {site}: a handful of people, a lot of coffee, and a server called {hostname}.</p>',
      '<p>{site} has been at {place} for longer than anyone here can remember.</p>\n<p>The website is newer. Slightly.</p>',
    ],
  },
  {
    file: 'contact.html',
    title: 'Contact',
    bodies: [
      '<p>General enquiries: <a href="mailto:info@{domain}">info@{domain}</a></p>\n<p>Problems with this site: <a href="mailto:helpdesk@{domain}">helpdesk@{domain}</a></p>',
      '<p>Write to us at <a href="mailto:info@{domain}">info@{domain}</a>. We answer within two working days.</p>',
      '<p>Something broken? Tell the helpdesk: <a href="mailto:helpdesk@{domain}">helpdesk@{domain}</a></p>\n<p>Everything else: <a href="mailto:info@{domain}">info@{domain}</a></p>',
    ],
  },
  {
    file: 'news.html',
    title: 'News',
    bodies: [
      '<h2>14 June 2026</h2>\n<p>The site has moved to a new server. Tell us if anything looks broken.</p>\n<h2>2 March 2026</h2>\n<p>New opening hours from next month.</p>',
      '<h2>30 May 2026</h2>\n<p>Scheduled maintenance this weekend. Expect short outages.</p>\n<h2>11 January 2026</h2>\n<p>Happy new year from everyone at {site}.</p>',
      '<h2>1 July 2026</h2>\n<p>Summer schedule is now in effect.</p>\n<h2>20 April 2026</h2>\n<p>Thanks to everyone who came to the spring open day.</p>\n<h2>9 February 2026</h2>\n<p>The contact form is gone; please email us instead.</p>',
    ],
  },
  {
    file: 'faq.html',
    title: 'FAQ',
    bodies: [
      '<h2>Is there Wi-Fi?</h2>\n<p>Yes. Ask for the password.</p>\n<h2>Can I pay by card?</h2>\n<p>Yes, everywhere except the vending machine.</p>',
      '<h2>Who runs this site?</h2>\n<p>The webmaster, in their spare time.</p>\n<h2>Why is it so plain?</h2>\n<p>Because it loads on anything.</p>',
      '<h2>How do I reach you?</h2>\n<p>See the contact page.</p>\n<h2>Do you have parking?</h2>\n<p>There is a small lot behind the building.</p>',
    ],
  },
  {
    file: 'privacy.html',
    title: 'Privacy',
    bodies: [
      '<p>This site sets no cookies and keeps a standard web server log, rotated daily.</p>',
      '<p>{site} does not sell or share your details. Server logs are kept for troubleshooting and deleted after a while.</p>',
    ],
  },
  {
    file: 'links.html',
    title: 'Links',
    bodies: [
      '<p>Places we like:</p>\n<ul>\n<li>The farmers market, Saturdays</li>\n<li>The public library reading room</li>\n<li>The repair café, first Sunday of the month</li>\n</ul>',
      '<p>Useful local services:</p>\n<ul>\n<li>Bus timetables at the station office</li>\n<li>Recycling collection every other Tuesday</li>\n</ul>',
    ],
  },
  {
    file: 'accessibility.html',
    title: 'Accessibility',
    bodies: [
      '<p>Step-free access is available at the side entrance. Please ask if you need help.</p>',
      '<p>This site is plain text on purpose, so it works with screen readers and text browsers alike.</p>',
    ],
  },
];

/** Pages particular to a kind of place. */
export const SITE_PAGES: Readonly<Record<NetworkCategory, readonly SitePage[]>> = {
  corporate: [
    {
      file: 'services.html',
      title: 'Services',
      bodies: [
        '<ul>\n<li>Managed infrastructure</li>\n<li>Consulting and audits</li>\n<li>Round-the-clock support</li>\n</ul>',
        '<p>{site} offers logistics, procurement and facilities management to clients of every size.</p>',
      ],
    },
    {
      file: 'careers.html',
      title: 'Careers',
      bodies: [
        '<p>We are hiring a systems administrator and a junior accountant.</p>\n<p>Send a CV to <a href="mailto:jobs@{domain}">jobs@{domain}</a>.</p>',
        '<p>No open positions right now. Speculative applications are always read.</p>',
      ],
    },
    {
      file: 'clients.html',
      title: 'Clients',
      bodies: [
        '<p>Our clients include regional councils, two hospitals and a surprising number of breweries.</p>',
        '<p>We do not publish our client list. Ask us for references.</p>',
      ],
    },
    {
      file: 'locations.html',
      title: 'Locations',
      bodies: [
        '<table>\n<tr><th>Office</th><th>Floor</th><th>Reception</th></tr>\n<tr><td>Head office</td><td>4</td><td>08:00–18:00</td></tr>\n<tr><td>Warehouse</td><td>Ground</td><td>07:00–15:00</td></tr>\n</table>',
        '<p>Head office is at {place}. Visitors sign in at reception.</p>',
      ],
    },
    {
      file: 'support.html',
      title: 'Support',
      bodies: [
        '<p>Customers can reach support by email: <a href="mailto:helpdesk@{domain}">helpdesk@{domain}</a></p>\n<pre>\nPriority 1  within 1 hour\nPriority 2  within 4 hours\nPriority 3  next working day\n</pre>',
        '<p>Support is available Monday to Friday. Out of hours, email the helpdesk and we will call you back.</p>',
      ],
    },
  ],
  cafe: [
    {
      file: 'menu.html',
      title: 'Menu',
      bodies: [
        '<table>\n<tr><th>Drink</th><th>Small</th><th>Large</th></tr>\n<tr><td>Espresso</td><td>2 €</td><td>3 €</td></tr>\n<tr><td>Flat white</td><td>3 €</td><td>4 €</td></tr>\n<tr><td>Tea</td><td>2 €</td><td>3 €</td></tr>\n<tr><td>Hot chocolate</td><td>3 €</td><td>4 €</td></tr>\n</table>',
        '<table>\n<tr><th>Food</th><th>Price</th></tr>\n<tr><td>Toast and jam</td><td>3 €</td></tr>\n<tr><td>Soup of the day</td><td>6 €</td></tr>\n<tr><td>Carrot cake</td><td>4 €</td></tr>\n<tr><td>Grilled cheese</td><td>7 €</td></tr>\n</table>',
      ],
    },
    {
      file: 'hours.html',
      title: 'Opening hours',
      bodies: [
        '<table>\n<tr><td>Monday–Friday</td><td>07:30–18:00</td></tr>\n<tr><td>Saturday</td><td>09:00–17:00</td></tr>\n<tr><td>Sunday</td><td>Closed</td></tr>\n</table>',
        '<table>\n<tr><td>Every day</td><td>08:00–22:00</td></tr>\n<tr><td>Bank holidays</td><td>10:00–16:00</td></tr>\n</table>',
      ],
    },
    {
      file: 'events.html',
      title: 'Events',
      bodies: [
        '<p>Open mic every other Friday. Board games on Tuesdays.</p>',
        '<p>Latte art class, first Saturday of the month. Sign up at the counter.</p>',
      ],
    },
    {
      file: 'catering.html',
      title: 'Catering',
      bodies: [
        '<p>We cater office lunches and small parties. Order two days ahead: <a href="mailto:orders@{domain}">orders@{domain}</a></p>',
        '<p>Cakes to order for birthdays and weddings. Ask at the counter.</p>',
      ],
    },
    {
      file: 'wifi.html',
      title: 'Wi-Fi',
      bodies: [
        '<p>Free Wi-Fi for customers. Please do not stream video at the big table.</p>',
        '<p>The Wi-Fi password is printed on your receipt and changes every week.</p>',
      ],
    },
  ],
  residential: [
    {
      file: 'posts.html',
      title: 'Posts',
      bodies: [
        '<h2>Fixed the boiler (again)</h2>\n<p>Turns out it was the pressure valve. It is always the pressure valve.</p>\n<h2>Garden update</h2>\n<p>The tomatoes survived the frost. The basil did not.</p>',
        '<h2>New shelves</h2>\n<p>Three hours, one wall, forty screws. Only two left over.</p>\n<h2>Moving the server</h2>\n<p>It lives in the cupboard now. The fan is quieter than the fridge.</p>',
      ],
    },
    {
      file: 'recipes.html',
      title: 'Recipes',
      bodies: [
        '<h2>Lentil soup</h2>\n<pre>\n1 onion, chopped\n2 carrots, diced\n200 g red lentils\n1 litre stock\n</pre>\n<p>Simmer for half an hour. Blend if you like.</p>',
        '<h2>Flatbread</h2>\n<pre>\n250 g flour\n150 ml water\na pinch of salt\n</pre>\n<p>Rest, roll, and cook in a dry pan.</p>',
      ],
    },
    {
      file: 'projects.html',
      title: 'Projects',
      bodies: [
        '<ul>\n<li>Weather station on the balcony</li>\n<li>A bookshelf that is actually level</li>\n<li>This website</li>\n</ul>',
        '<p>Current project: a doorbell that texts me. Previous project: a doorbell.</p>',
      ],
    },
    {
      file: 'photos.html',
      title: 'Photos',
      bodies: [
        '<p>The photo gallery moved to the shared drive. This page is here so the old links still work.</p>',
        '<p>No photos yet. The camera is somewhere in a box from the move.</p>',
      ],
    },
    {
      file: 'guestbook.html',
      title: 'Guestbook',
      bodies: [
        '<p>Nice site! — a visitor</p>\n<p>Found you through the local forum. — another visitor</p>',
        '<p>The guestbook is closed after a flood of spam. Thank you to the three real people who signed it.</p>',
      ],
    },
  ],
  university: [
    {
      file: 'courses.html',
      title: 'Courses',
      bodies: [
        '<table>\n<tr><th>Code</th><th>Course</th><th>Term</th></tr>\n<tr><td>CS101</td><td>Introduction to Programming</td><td>Autumn</td></tr>\n<tr><td>CS204</td><td>Operating Systems</td><td>Spring</td></tr>\n<tr><td>CS310</td><td>Computer Networks</td><td>Spring</td></tr>\n</table>',
        '<table>\n<tr><th>Code</th><th>Course</th><th>Room</th></tr>\n<tr><td>MA120</td><td>Linear Algebra</td><td>B12</td></tr>\n<tr><td>PH201</td><td>Thermodynamics</td><td>Lab 3</td></tr>\n</table>',
      ],
    },
    {
      file: 'seminars.html',
      title: 'Seminars',
      bodies: [
        '<p>Research seminars are held on Wednesdays at four in the reading room.</p>',
        '<p>This term: distributed systems, graph theory, and a talk on why the printer never works.</p>',
      ],
    },
    {
      file: 'research.html',
      title: 'Research',
      bodies: [
        '<ul>\n<li>Networked systems</li>\n<li>Security and privacy</li>\n<li>Human–computer interaction</li>\n</ul>',
        '<p>Our groups publish widely. Preprints are available from the department office.</p>',
      ],
    },
    {
      file: 'admissions.html',
      title: 'Admissions',
      bodies: [
        '<p>Applications for next year open in October. Questions: <a href="mailto:admissions@{domain}">admissions@{domain}</a></p>',
        '<p>Visit days run every month during term. No booking needed.</p>',
      ],
    },
    {
      file: 'timetable.html',
      title: 'Timetable',
      bodies: [
        '<table>\n<tr><th>Day</th><th>09:00</th><th>11:00</th><th>14:00</th></tr>\n<tr><td>Monday</td><td>Lecture</td><td>Lab</td><td></td></tr>\n<tr><td>Wednesday</td><td>Lecture</td><td></td><td>Seminar</td></tr>\n<tr><td>Friday</td><td>Tutorial</td><td>Lab</td><td></td></tr>\n</table>',
        '<p>Timetables are published two weeks before term starts.</p>',
      ],
    },
  ],
  public: [
    {
      file: 'hours.html',
      title: 'Opening hours',
      bodies: [
        '<table>\n<tr><td>Monday–Thursday</td><td>09:00–20:00</td></tr>\n<tr><td>Friday</td><td>09:00–17:00</td></tr>\n<tr><td>Saturday</td><td>10:00–16:00</td></tr>\n<tr><td>Sunday</td><td>Closed</td></tr>\n</table>',
        '<table>\n<tr><td>Every day</td><td>06:00–23:30</td></tr>\n<tr><td>Ticket office</td><td>07:00–19:00</td></tr>\n</table>',
      ],
    },
    {
      file: 'notices.html',
      title: 'Notices',
      bodies: [
        '<p>The lift on the east side is out of service until further notice.</p>\n<p>Lost property is held at the front desk for one month.</p>',
        '<p>Planned works on the weekend may affect Wi-Fi coverage.</p>',
      ],
    },
    {
      file: 'events.html',
      title: 'Events',
      bodies: [
        '<p>Story time for children, Saturdays at ten.</p>\n<p>Local history talk, last Thursday of the month.</p>',
        '<p>Summer concerts on the lawn, weather permitting.</p>',
      ],
    },
    {
      file: 'services.html',
      title: 'Services',
      bodies: [
        '<ul>\n<li>Free public computers</li>\n<li>Printing and scanning</li>\n<li>Meeting rooms to book</li>\n</ul>',
        '<ul>\n<li>Left luggage</li>\n<li>Accessible toilets</li>\n<li>Travel information</li>\n</ul>',
      ],
    },
    {
      file: 'timetable.html',
      title: 'Timetable',
      bodies: [
        '<table>\n<tr><th>Route</th><th>First</th><th>Last</th><th>Every</th></tr>\n<tr><td>Line 1</td><td>05:40</td><td>00:10</td><td>8 min</td></tr>\n<tr><td>Line 4</td><td>06:15</td><td>23:30</td><td>15 min</td></tr>\n</table>',
        '<p>Printed timetables are available at the information desk.</p>',
      ],
    },
  ],
  iot: [
    {
      file: 'dashboard.html',
      title: 'Dashboard',
      bodies: [
        '<table>\n<tr><th>Room</th><th>Temperature</th><th>Humidity</th></tr>\n<tr><td>Kitchen</td><td>21 °C</td><td>48%</td></tr>\n<tr><td>Hallway</td><td>18 °C</td><td>52%</td></tr>\n</table>',
        '<p>All devices reporting. Last update a few minutes ago.</p>',
      ],
    },
    {
      file: 'devices.html',
      title: 'Devices',
      bodies: [
        '<table>\n<tr><th>Device</th><th>State</th></tr>\n<tr><td>Front door lock</td><td>Locked</td></tr>\n<tr><td>Porch light</td><td>Off</td></tr>\n<tr><td>Thermostat</td><td>Heating</td></tr>\n</table>',
        '<table>\n<tr><th>Device</th><th>Battery</th></tr>\n<tr><td>Motion sensor</td><td>72%</td></tr>\n<tr><td>Window sensor</td><td>15%</td></tr>\n</table>',
      ],
    },
    {
      file: 'energy.html',
      title: 'Energy',
      bodies: [
        '<p>Today: 9 kWh used, 4 kWh from the panels.</p>',
        '<p>This month is running slightly above last month. The dryer is the usual suspect.</p>',
      ],
    },
    {
      file: 'schedule.html',
      title: 'Schedule',
      bodies: [
        '<table>\n<tr><th>Time</th><th>Action</th></tr>\n<tr><td>06:30</td><td>Heating on</td></tr>\n<tr><td>08:30</td><td>Heating off</td></tr>\n<tr><td>22:00</td><td>Porch light off</td></tr>\n</table>',
        '<p>Schedules pause automatically when everyone is away.</p>',
      ],
    },
    {
      file: 'alerts.html',
      title: 'Alerts',
      bodies: [
        '<p>No alerts in the last 24 hours.</p>',
        '<p>Window sensor battery low. Replace soon.</p>',
      ],
    },
  ],
  hacker: [
    {
      file: 'projects.html',
      title: 'Projects',
      bodies: [
        '<ul>\n<li>A badge that blinks in Morse</li>\n<li>Reflow oven from a toaster</li>\n<li>A very loud doorbell</li>\n</ul>',
        '<p>Current projects are listed on the whiteboard by the door. This page is always out of date.</p>',
      ],
    },
    {
      file: 'meetups.html',
      title: 'Meetups',
      bodies: [
        '<table>\n<tr><th>Night</th><th>What</th></tr>\n<tr><td>Tuesday</td><td>Soldering</td></tr>\n<tr><td>Thursday</td><td>Open night</td></tr>\n<tr><td>Saturday</td><td>Capture the flag practice</td></tr>\n</table>',
        '<p>Open night every Thursday from seven. Newcomers welcome.</p>',
      ],
    },
    {
      file: 'wiki.html',
      title: 'Wiki',
      bodies: [
        '<h2>Using the laser cutter</h2>\n<pre>\n1. Extraction on\n2. Lid closed\n3. Never leave it running\n</pre>',
        '<h2>Door code</h2>\n<p>Ask a keyholder. It is not on the wiki, and it never will be.</p>',
      ],
    },
    {
      file: 'conduct.html',
      title: 'Code of conduct',
      bodies: [
        '<p>Be excellent to each other. Ask before touching someone else’s project.</p>',
        '<p>Harassment is not tolerated. Talk to any keyholder if something is wrong.</p>',
      ],
    },
    {
      file: 'membership.html',
      title: 'Membership',
      bodies: [
        '<p>Membership is monthly and pays the rent. Keyholders get 24-hour access.</p>',
        '<p>Join at any open night. Bring a friend.</p>',
      ],
    },
  ],
};

/** What a place calls the people it lists, by kind of place — the roles a team page
 *  gives the people on the network, never their logins. */
export const PEOPLE_ROLES: Readonly<Record<NetworkCategory, readonly string[]>> = {
  corporate: ['Operations', 'Finance', 'Sales', 'Support', 'Facilities', 'Legal'],
  cafe: ['Manager', 'Barista', 'Kitchen', 'Front of house'],
  residential: ['Housemate', 'Family', 'Flatmate'],
  university: ['Lecturer', 'Research fellow', 'Doctoral student', 'Administrator', 'Lab technician'],
  public: ['Duty manager', 'Librarian', 'Volunteer', 'Facilities'],
  iot: ['Resident', 'Owner', 'Guest room'],
  hacker: ['Keyholder', 'Treasurer', 'Member', 'Events'],
};

/** What an intranet portal says on its front page. */
export const PORTAL_FRONT_PAGES: readonly string[] = [
  '<p>Intranet for {place}. Everything here is internal — please do not share links outside.</p>',
  '<p>Welcome to the {site} intranet. Start with Services to find what runs where.</p>',
  '<p>Internal wiki for {place}. If a page is wrong, fix it or tell the helpdesk.</p>',
  '<p>The {site} staff portal: how-tos, the people, and the machines on the network.</p>',
];

/** An intranet's how-tos and notes, the same kind of page at any kind of place. */
export const PORTAL_PAGES: readonly SitePage[] = [
  {
    file: 'printing.html',
    title: 'Printing',
    bodies: [
      '<p>Send jobs to the printer by the door. Jam? Open tray two, not tray one.</p>',
      '<p>Colour printing is for client work only. Toner is in the cupboard under the stairs.</p>',
    ],
  },
  {
    file: 'wifi.html',
    title: 'Wi-Fi',
    bodies: [
      '<p>Staff and guests share one network. The password is on the card behind reception.</p>',
      '<p>If the Wi-Fi drops, the access point is in the hallway. Unplug it, count to ten, plug it back in.</p>',
    ],
  },
  {
    file: 'shared-drive.html',
    title: 'Shared drive',
    bodies: [
      '<p>Documents go on the shared drive, not on your desktop. Your desktop is not backed up.</p>\n<pre>\nDocuments/   everyone\nInvoices/    finance only\nArchive/     read only\n</pre>',
      '<p>The Services page says where the shared drive lives. Ask the helpdesk for an account.</p>',
    ],
  },
  {
    file: 'new-starters.html',
    title: 'New starters',
    bodies: [
      '<ol>\n<li>Collect a key from reception</li>\n<li>Read the Wi-Fi page</li>\n<li>Say hello to the team</li>\n</ol>',
      '<p>Welcome! Your manager will walk you through your first week. Lunch on day one is on us.</p>',
    ],
  },
  {
    file: 'backups.html',
    title: 'Backups',
    bodies: [
      '<p>The shared drive is backed up every night at two. Restores take a day — ask the helpdesk.</p>',
      '<pre>\nnightly   02:00   shared drive\nweekly    Sunday  everything else\n</pre>',
    ],
  },
  {
    file: 'holidays.html',
    title: 'Holidays',
    bodies: [
      '<table>\n<tr><th>Closed</th><th>Why</th></tr>\n<tr><td>25–26 December</td><td>Christmas</td></tr>\n<tr><td>1 January</td><td>New year</td></tr>\n<tr><td>1 May</td><td>Bank holiday</td></tr>\n</table>',
      '<p>Book holidays with your manager at least two weeks ahead.</p>',
    ],
  },
];

/** An API's endpoint: a document a client fetches, and what the reference says of it. */
export type ApiEndpoint = {
  /** Its path beneath the document root, e.g. `api/v1/menu`. */
  readonly file: string;
  readonly summary: string;
  /** The JSON it returns, with slots. */
  readonly body: string;
};

/** The endpoint every API's reference shows as its worked example. */
export const API_STATUS_ENDPOINT: ApiEndpoint = {
  file: 'api/v1/status',
  summary: 'service status',
  body: '{"service":"{site}","status":"ok","maintenance":false}',
};

/** The endpoints every API answers, whatever it is for. */
export const API_COMMON_ENDPOINTS: readonly ApiEndpoint[] = [
  { file: 'health', summary: 'liveness check', body: '{"status":"ok","host":"{hostname}"}' },
  API_STATUS_ENDPOINT,
];

/** The endpoints an API serves for its kind of place. */
export const API_ENDPOINTS: Readonly<Record<NetworkCategory, readonly ApiEndpoint[]>> = {
  corporate: [
    { file: 'api/v1/offices', summary: 'office locations', body: '{"offices":[{"name":"Head office","floor":4},{"name":"Warehouse","floor":0}]}' },
    { file: 'api/v1/services', summary: 'services offered', body: '{"services":["infrastructure","consulting","support"]}' },
    { file: 'api/v1/tickets/summary', summary: 'open support tickets', body: '{"open":12,"closed_this_week":31}' },
  ],
  cafe: [
    { file: 'api/v1/menu', summary: 'the menu, prices in euros', body: '{"items":[{"name":"Espresso","price":2},{"name":"Flat white","price":3},{"name":"Carrot cake","price":4}]}' },
    { file: 'api/v1/hours', summary: 'opening hours', body: '{"weekdays":"07:30-18:00","saturday":"09:00-17:00","sunday":null}' },
    { file: 'api/v1/orders/queue', summary: 'orders waiting', body: '{"waiting":3}' },
  ],
  residential: [
    { file: 'api/v1/posts', summary: 'latest posts', body: '{"posts":[{"title":"Fixed the boiler (again)"},{"title":"Garden update"}]}' },
    { file: 'api/v1/weather', summary: 'balcony weather station', body: '{"temperature_c":17,"humidity":61}' },
  ],
  university: [
    { file: 'api/v1/courses', summary: 'courses this year', body: '{"courses":[{"code":"CS101","term":"autumn"},{"code":"CS204","term":"spring"}]}' },
    { file: 'api/v1/rooms', summary: 'bookable rooms', body: '{"rooms":["B12","Lab 3","Reading room"]}' },
    { file: 'api/v1/seminars', summary: 'upcoming seminars', body: '{"seminars":[{"day":"Wednesday","time":"16:00"}]}' },
  ],
  public: [
    { file: 'api/v1/hours', summary: 'opening hours', body: '{"weekdays":"09:00-20:00","saturday":"10:00-16:00","sunday":null}' },
    { file: 'api/v1/notices', summary: 'current notices', body: '{"notices":["East lift out of service"]}' },
    { file: 'api/v1/departures', summary: 'next departures', body: '{"departures":[{"line":1,"in_minutes":4},{"line":4,"in_minutes":11}]}' },
  ],
  iot: [
    { file: 'api/v1/devices', summary: 'devices and their state', body: '{"devices":[{"name":"front door lock","state":"locked"},{"name":"porch light","state":"off"}]}' },
    { file: 'api/v1/readings', summary: 'latest sensor readings', body: '{"kitchen_c":21,"hallway_c":18}' },
    { file: 'api/v1/energy', summary: 'energy use today', body: '{"used_kwh":9,"solar_kwh":4}' },
  ],
  hacker: [
    { file: 'api/v1/events', summary: 'meetups this month', body: '{"events":[{"night":"Thursday","what":"open night"}]}' },
    { file: 'api/v1/space', summary: 'is the space open', body: '{"open":true,"keyholders_present":2}' },
    { file: 'api/v1/projects', summary: 'current projects', body: '{"projects":["morse badge","toaster reflow oven"]}' },
  ],
};

/** What an API's reference says around its endpoint list. */
export const API_FRONT_PAGES: readonly string[] = [
  '<p>JSON API for {site}. Responses are UTF-8, and every endpoint answers GET.</p>',
  '<p>Internal API used by the {site} apps. Documented here for whoever maintains it next.</p>',
  '<p>This service answers read-only requests from inside the network.</p>',
];

/** An API's other documentation pages. */
export const API_PAGES: readonly SitePage[] = [
  {
    file: 'authentication.html',
    title: 'Authentication',
    bodies: [
      '<p>Read-only endpoints need no key from inside the network. Write access is not offered.</p>',
      '<p>Clients outside the network are refused at the firewall, so nothing here asks for a key.</p>',
    ],
  },
  {
    file: 'errors.html',
    title: 'Errors',
    bodies: [
      '<table>\n<tr><th>Status</th><th>Meaning</th></tr>\n<tr><td>404</td><td>No such endpoint</td></tr>\n<tr><td>503</td><td>Down for maintenance</td></tr>\n</table>',
      '<p>Errors come back as JSON with an <code>error</code> field and the matching HTTP status.</p>',
    ],
  },
  {
    file: 'rate-limits.html',
    title: 'Rate limits',
    bodies: [
      '<p>Sixty requests a minute per client. Past that, you get a 429 and a lecture.</p>',
      '<p>No rate limits yet. Please do not make us add them.</p>',
    ],
  },
  {
    file: 'examples.html',
    title: 'Examples',
    bodies: [
      '<pre>\nGET /health\n{"status":"ok","host":"{hostname}"}\n</pre>\n<p>Any HTTP client works; so does a browser.</p>',
      '<p>Fetch any endpoint with a plain GET. Responses are small enough to read by eye.</p>',
    ],
  },
];

/**
 * What a site keeps that no page links: the paths a default sweep turns up. Each is a
 * word on the default path list, because membership in that list is what makes a path
 * findable at all — and each is something an operator really leaves lying around.
 *
 * Directories carry a page of their own, since a sweep finds a directory only by the
 * index inside it; words that only make sense as a listing (`backup/`, `uploads/`) are
 * not here, because this world's servers list nothing.
 */

/** The words a site may keep unlinked, each a path the default list tries. */
export const HIDDEN_WORDS = [
  'old',
  'staging',
  'test',
  'admin',
  'dashboard',
  'internal',
  'notes.txt',
  'todo.txt',
  'readme.txt',
  'status',
  'health',
  'server-status',
  'metrics',
  '.env',
  'dump.sql',
] as const;

export type HiddenWord = (typeof HIDDEN_WORDS)[number];

/** An earlier version of the site, kept until the new one is signed off. */
export const OLD_SITE_PAGES: readonly string[] = [
  '<p>This is the old site. It stays up until the new one is signed off.</p>\n<p>Last updated 3 March 2025.</p>',
  '<p>Archived copy of the previous {site} site. Nothing here is maintained.</p>',
  '<p>You are looking at the old layout. The current site is at <a href="/">the front page</a>.</p>',
];

/** A draft copy nobody meant to publish. */
export const DRAFT_NOTICES: readonly string[] = [
  '<p><strong>DRAFT — not for publication.</strong></p>',
  '<p>Staging copy. Changes here go live after review.</p>',
  '<p>Test build of the front page. Please ignore.</p>',
];

/** What an internal page says to whoever opens it. */
export const INTERNAL_PAGES: readonly string[] = [
  '<p>Staff only. If you are reading this from outside, tell the helpdesk.</p>\n<p>The public site is at <a href="/">the front page</a>.</p>',
  '<p>Internal notices for {place}. Nothing on this page is for customers.</p>',
];

/** Lines a webmaster leaves in a text file, with slots for the paths they are about. */
export const NOTE_LINES: readonly string[] = [
  'move {page} into the new layout',
  'check {page} renders in a text browser',
  'take {hidden} down once the new site is signed off',
  'nobody reads {page}, delete it?',
  'ask about the spelling on {page}',
  'fix the footer on {page}',
  'tidy {hidden} before the audit',
];

/** How a text file of notes is headed. */
export const NOTE_HEADINGS: readonly string[] = ['Notes', 'TODO', 'README', 'Things to fix'];

/**
 * Directories a robots.txt may ask crawlers to stay out of that the default path list
 * never tries — found only by reading robots.txt and adding the name to your own list,
 * the loop an editable path list exists for. None may be on the default list, or a
 * sweep would find it without the reading.
 */
export const ROBOTS_ONLY_DIRECTORIES: readonly string[] = [
  'drafts',
  'archive-2025',
  'intranet-old',
  'preview',
  'wip',
  'legacy',
  'beta',
];

/** What such a directory holds: the page it was kept for. */
export const ROBOTS_ONLY_PAGES: readonly string[] = [
  '<p>Work in progress. Not linked from anywhere on purpose.</p>',
  '<p>Kept for reference after the redesign. Do not update.</p>',
  '<p>Preview of the next version of the front page. Not live yet.</p>',
];

/** The comments a page's author leaves about an unlinked path, keyed by the word the
 *  path is. `{path}` is filled with the path as a request names it. */
export const PATH_COMMENTS: Readonly<Record<HiddenWord, readonly string[]>> = {
  old: ['old site kept at {path} until the migration is signed off', 'previous layout still at {path}'],
  staging: ['preview changes at {path} before pushing live'],
  test: ['test copy at {path}, remember to take it down'],
  admin: ['admin login moved to {path}'],
  dashboard: ['stats are on {path} now'],
  internal: ['staff notices live at {path}'],
  'notes.txt': ['see {path} for what is left to do'],
  'todo.txt': ['todo list in {path}'],
  'readme.txt': ['deploy notes in {path}'],
  status: ['monitoring polls {path}'],
  health: ['load balancer checks {path}'],
  'server-status': ['{path} is open to the LAN only, right?'],
  metrics: ['scraped from {path} every minute'],
  '.env': ['keys are in {path} now, not in the page'],
  'dump.sql': ['nightly schema dump lands in {path}'],
};
