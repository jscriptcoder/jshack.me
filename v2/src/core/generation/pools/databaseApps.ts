/**
 * The applications a generated database can hold, as data.
 *
 * Each is the kind of software a place really runs — a café's till, an office's
 * helpdesk, a library's circulation desk — described as tables whose columns say how
 * they are filled rather than holding rows. The rows are drawn per box, so two
 * databases running one application hold different data.
 *
 * Every value here is a thing a place would store and nothing more. No address names a
 * host, no field holds a path, no row carries a mail address (only the login table
 * does, on the network's own zone), money is whole euros, and no string states a
 * software version: a version dates a box, and only its package manifest may.
 */

import type { MysqlColumnType } from '../../mysql/types';

/** How one column's value is drawn for a row. */
export type Fill =
  /** The primary key: 1, 2, 3… in the order the rows were made. */
  | { readonly kind: 'serial' }
  /** The moment the row was made. Rows ascend in it, and it never precedes a row the
   *  row refers to. At most one per table. */
  | { readonly kind: 'stamp' }
  /** The id of a row in an earlier table (or `users`). */
  | { readonly kind: 'ref'; readonly table: string }
  | { readonly kind: 'pick'; readonly values: readonly string[] }
  /** A value no other row in the table holds, so the table is capped at the list. */
  | { readonly kind: 'unique'; readonly values: readonly string[] }
  | { readonly kind: 'int'; readonly min: number; readonly max: number }
  | { readonly kind: 'flag'; readonly chance: number }
  /** A fictional person's full name — a customer, a member, a student. */
  | { readonly kind: 'person' }
  /** A unique reference number: the prefix, then a number counting up from `start`. */
  | { readonly kind: 'code'; readonly prefix: string; readonly start: number };

export type ColumnSpec = {
  readonly name: string;
  readonly type: MysqlColumnType;
  readonly fill: Fill;
  readonly nullable?: boolean;
};

/** A row before it is dated and numbered: its cells, and the earliest moment it can
 *  have been made. */
export type Draft = { readonly cells: Readonly<Record<string, string | number | null>>; readonly after: number };

/** What a table's own drafting can see: the logins, with the moment each was made. */
export type DraftContext = {
  readonly users: readonly { readonly id: number; readonly username: string; readonly madeAt: number }[];
  readonly pick: <Item>(items: readonly Item[]) => Item;
  readonly pickN: <Item>(items: readonly Item[], count: number) => readonly Item[];
  readonly nextInt: (min: number, max: number) => number;
};

export type TableSpec = {
  readonly name: string;
  /** Present in every database running the application; the rest are drawn. A table
   *  another refers to is always required, so no reference can point at a table the
   *  database does not hold. */
  readonly required: boolean;
  readonly columns: readonly ColumnSpec[];
  /** Rows that follow from something other than a count — a mailbox per login. */
  readonly draft?: (context: DraftContext) => readonly Draft[];
};

export type Archetype = {
  /** What a database running it is called. */
  readonly names: readonly string[];
  /** In an order where every table comes after the tables it refers to. */
  readonly tables: readonly TableSpec[];
};

const column = (name: string, type: MysqlColumnType, fill: Fill): ColumnSpec => ({ name, type, fill });
const id: ColumnSpec = column('id', 'INT', { kind: 'serial' });
const stamp = (name: string) => column(name, 'DATETIME', { kind: 'stamp' });
const ref = (name: string, table: string) => column(name, 'INT', { kind: 'ref', table });
const pick = (name: string, values: readonly string[]) => column(name, 'VARCHAR', { kind: 'pick', values });
const text = (name: string, values: readonly string[]) => column(name, 'TEXT', { kind: 'pick', values });
const unique = (name: string, values: readonly string[]) =>
  column(name, 'VARCHAR', { kind: 'unique', values });
const whole = (name: string, min: number, max: number) => column(name, 'INT', { kind: 'int', min, max });
const flag = (name: string, chance: number) => column(name, 'BOOLEAN', { kind: 'flag', chance });
const person = (name: string) => column(name, 'VARCHAR', { kind: 'person' });
const code = (name: string, prefix: string, start: number) =>
  column(name, 'VARCHAR', { kind: 'code', prefix, start });

const COMPANIES = [
  'Harbour Logistics', 'Northgate Dental', 'Meridian Foods', 'Copperfield Legal', 'Brightwater Hotels',
  'Kestrel Engineering', 'Oakline Furniture', 'Pinecrest Schools', 'Redfern Motors', 'Silverline Travel',
  'Thornbury Farms', 'Vantage Print', 'Willow Care Homes', 'Ashford Builders', 'Bluebell Florists',
  'Castlegate Insurance', 'Driftwood Marine', 'Elmstead Clinics', 'Foxglove Bakery', 'Granite Security',
];
const PRODUCTS = [
  'Pallet wrap', 'Cable ties', 'Label rolls', 'Safety gloves', 'Box cutter', 'Packing tape', 'Bubble wrap',
  'Hand truck', 'Shelf bins', 'Barcode scanner', 'Hi-vis vest', 'Floor tape', 'Stretch film', 'Void fill',
  'Mailer bags', 'Corner guards', 'Strapping kit', 'Desk lamp', 'Toner cartridge', 'Printer paper',
];
const MENU = [
  'Espresso', 'Double espresso', 'Americano', 'Flat white', 'Cappuccino', 'Latte', 'Mocha', 'Cortado',
  'Hot chocolate', 'Chai latte', 'English breakfast tea', 'Peppermint tea', 'Croissant', 'Pain au chocolat',
  'Almond croissant', 'Banana bread', 'Cheese scone', 'Bacon roll', 'Avocado toast', 'Soup of the day',
  'Ham and cheese toastie', 'Carrot cake', 'Brownie', 'Fresh orange juice',
];
const TITLES = [
  'The Long Harbour', 'Night Shift', 'Paper Moons', 'The Quiet Coast', 'Borrowed Time', 'Salt and Iron',
  'The Last Orchard', 'City of Glass', 'Northern Lights', 'The Cartographer', 'Small Hours', 'Wild Acre',
  'The Tin Crown', 'Low Tide', 'A Winter Garden', 'The Signal', 'Open Water', 'Hollow Hill',
];
const RECIPES = [
  'Lentil soup', 'Chicken traybake', 'Veggie chilli', 'Spaghetti bolognese', 'Fish pie', 'Mushroom risotto',
  'Thai green curry', 'Shepherd’s pie', 'Pancakes', 'Banana bread', 'Roast chicken', 'Bean burritos',
];
const COURSES = [
  'Intro to Programming', 'Data Structures', 'Linear Algebra', 'Statistics', 'Organic Chemistry',
  'Modern History', 'Microeconomics', 'Networks and Security', 'Databases', 'Academic Writing',
  'Cell Biology', 'Discrete Mathematics', 'Operating Systems', 'Machine Learning',
];
const BOOKS = [
  'A History of Rivers', 'The Garden Year', 'Coastal Walks', 'Starting With Clay', 'The Night Sky',
  'Bread at Home', 'Birds of the Hedgerow', 'The Map Room', 'Old Roads', 'Cooking on a Budget',
  'The Patient Gardener', 'Local Legends', 'Rain on the Moor', 'A Field Guide to Fungi', 'The Clockmaker',
];
const ROOMS = ['Main hall', 'Room 1', 'Room 2', 'Room 3', 'Studio', 'Meeting room', 'Garden room', 'Kitchen'];
const DEVICES = [
  'Hallway thermostat', 'Kitchen thermostat', 'Front door sensor', 'Back door sensor', 'Garage motion sensor',
  'Living room plug', 'Boiler meter', 'Porch camera', 'Loft humidity sensor', 'Utility room leak sensor',
];
const TEAMS = [
  'null pointers', 'bit flippers', 'rootkit rangers', 'stack smashers', 'hex appeal', 'packet pirates',
  'segfault city', 'shell shock', 'ctrl alt defeat', 'byte club',
];
const CHALLENGES = [
  'baby rop', 'cookie monster', 'broken rsa', 'lost in the logs', 'sql for beginners', 'the locked vault',
  'xor party', 'hidden in plain sight', 'race the clock', 'forgotten backup', 'format this', 'maze runner',
];
const WIKI_PAGES = [
  'Getting started', 'Lab rules', 'Wifi and guest access', 'Soldering station', 'Printer howto',
  'Meeting notes', 'Tool library', 'Door access', 'Project ideas', 'Cleaning rota', 'Server rack', 'Budget',
];
const CATEGORIES = ['News', 'Events', 'Announcements', 'Team', 'Projects', 'Policies', 'Social', 'Updates'];
const CLIENTS = [
  'mobile-app', 'billing-sync', 'partner-portal', 'reporting', 'warehouse-scanner', 'crm-bridge',
  'marketing-site', 'support-widget', 'nightly-export', 'kiosk',
];
const SHARED_MAILBOXES = ['info', 'sales', 'support', 'billing', 'postmaster', 'office', 'accounts'];
const ALIASES = ['help', 'contact', 'team', 'everyone', 'it', 'press', 'jobs', 'abuse', 'hello', 'orders'];

const helpdesk: Archetype = {
  names: ['helpdesk', 'servicedesk', 'support_desk'],
  tables: [
    {
      name: 'sla_policies',
      required: true,
      columns: [
        id,
        unique('name', ['Critical', 'High', 'Normal', 'Low', 'Planned', 'Internal']),
        whole('response_hours', 1, 72),
        flag('active', 0.85),
      ],
    },
    {
      name: 'tickets',
      required: true,
      columns: [
        id,
        ref('reporter_id', 'users'),
        ref('assignee_id', 'users'),
        ref('sla_id', 'sla_policies'),
        pick('subject', [
          'Printer offline', 'Cannot log in', 'VPN keeps dropping', 'New starter setup', 'Laptop battery',
          'Shared drive full', 'Password reset', 'Email not syncing', 'Monitor flickering', 'Software request',
        ]),
        pick('status', ['open', 'pending', 'resolved', 'closed']),
        stamp('opened_at'),
      ],
    },
    {
      name: 'ticket_comments',
      required: true,
      columns: [
        id,
        ref('ticket_id', 'tickets'),
        ref('author_id', 'users'),
        text('body', [
          'Looking into it now.', 'Restarted it, please try again.', 'Could you send a screenshot?',
          'Replaced the cable, working here.', 'Waiting on the supplier.', 'Fixed, closing this one.',
          'Same issue as last week.', 'Escalated to the office manager.',
        ]),
        stamp('posted_at'),
      ],
    },
    {
      name: 'assets',
      required: false,
      columns: [
        id,
        code('asset_tag', 'AST-', 1001),
        pick('description', ['Laptop', 'Monitor', 'Docking station', 'Desk phone', 'Headset', 'Keyboard']),
        ref('assigned_to', 'users'),
        whole('cost_eur', 20, 1800),
        stamp('purchased_at'),
      ],
    },
    {
      name: 'kb_articles',
      required: false,
      columns: [
        id,
        unique('title', [
          'Connecting to the office wifi', 'Setting up the printer', 'Resetting your password',
          'Booking a meeting room', 'Using the shared drive', 'Reporting a lost laptop', 'Out of hours support',
        ]),
        ref('author_id', 'users'),
        whole('views', 0, 900),
        stamp('published_at'),
      ],
    },
  ],
};

const crm: Archetype = {
  names: ['crm', 'sales_crm', 'pipeline'],
  tables: [
    {
      name: 'accounts',
      required: true,
      columns: [
        id,
        unique('company', COMPANIES),
        pick('industry', ['Retail', 'Healthcare', 'Logistics', 'Hospitality', 'Construction', 'Education']),
        ref('owner_id', 'users'),
        stamp('created_at'),
      ],
    },
    {
      name: 'contacts',
      required: true,
      columns: [
        id,
        ref('account_id', 'accounts'),
        person('full_name'),
        pick('job_title', ['Office Manager', 'Director', 'Buyer', 'Finance Lead', 'Operations Manager']),
        stamp('created_at'),
      ],
    },
    {
      name: 'deals',
      required: true,
      columns: [
        id,
        ref('account_id', 'accounts'),
        ref('owner_id', 'users'),
        pick('title', ['Annual renewal', 'New site rollout', 'Upgrade package', 'Pilot', 'Extra seats']),
        pick('stage', ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost']),
        whole('value_eur', 500, 90000),
        stamp('opened_at'),
      ],
    },
    {
      name: 'activities',
      required: false,
      columns: [
        id,
        ref('deal_id', 'deals'),
        ref('user_id', 'users'),
        pick('kind', ['call', 'meeting', 'demo', 'follow-up']),
        text('note', [
          'Left a voicemail.', 'Wants a revised quote.', 'Demo went well.', 'Budget signed off next month.',
          'Asked for references.', 'Chasing the contract.',
        ]),
        stamp('logged_at'),
      ],
    },
  ],
};

const stock: Archetype = {
  names: ['stock', 'inventory', 'warehouse_ops'],
  tables: [
    {
      name: 'suppliers',
      required: true,
      columns: [id, unique('name', COMPANIES), person('contact_name'), stamp('created_at')],
    },
    {
      name: 'products',
      required: true,
      columns: [
        id,
        code('sku', 'SKU-', 2040),
        unique('name', PRODUCTS),
        ref('supplier_id', 'suppliers'),
        whole('unit_price_eur', 2, 400),
        stamp('created_at'),
      ],
    },
    {
      name: 'stock_levels',
      required: true,
      columns: [
        id,
        ref('product_id', 'products'),
        pick('location', ['Aisle 1', 'Aisle 2', 'Aisle 3', 'Back store', 'Loading bay', 'Mezzanine']),
        whole('quantity', 0, 500),
        stamp('counted_at'),
      ],
    },
    {
      name: 'purchase_orders',
      required: false,
      columns: [
        id,
        ref('supplier_id', 'suppliers'),
        ref('raised_by', 'users'),
        whole('total_eur', 40, 12000),
        pick('status', ['draft', 'sent', 'received', 'cancelled']),
        stamp('raised_at'),
      ],
    },
    {
      name: 'stock_movements',
      required: false,
      columns: [
        id,
        ref('product_id', 'products'),
        ref('user_id', 'users'),
        whole('change_qty', -50, 120),
        pick('reason', ['delivery', 'dispatch', 'stock count', 'damaged', 'returned']),
        stamp('moved_at'),
      ],
    },
  ],
};

const till: Archetype = {
  names: ['till', 'till_prod', 'pos'],
  tables: [
    {
      name: 'menu_items',
      required: true,
      columns: [
        id,
        unique('name', MENU),
        pick('category', ['coffee', 'tea', 'bakery', 'food', 'cold drinks']),
        whole('price_eur', 2, 14),
        flag('available', 0.9),
        stamp('added_at'),
      ],
    },
    {
      name: 'orders',
      required: true,
      columns: [
        id,
        ref('served_by', 'users'),
        whole('table_no', 1, 20),
        whole('total_eur', 3, 60),
        flag('paid', 0.95),
        stamp('placed_at'),
      ],
    },
    {
      name: 'order_lines',
      required: true,
      columns: [id, ref('order_id', 'orders'), ref('menu_item_id', 'menu_items'), whole('quantity', 1, 4)],
    },
    {
      name: 'shifts',
      required: true,
      columns: [
        id,
        ref('user_id', 'users'),
        pick('position', ['barista', 'kitchen', 'front', 'closing']),
        whole('hours', 3, 10),
        stamp('started_at'),
      ],
    },
    {
      name: 'suppliers',
      required: false,
      columns: [
        id,
        unique('name', ['Hill Farm Dairy', 'Roastworks', 'Village Bakehouse', 'Green Grocer Co', 'Cup & Lid Supplies', 'Orchard Juices']),
        pick('delivers', ['milk', 'beans', 'pastries', 'produce', 'cups', 'juice']),
        person('contact_name'),
        stamp('since'),
      ],
    },
  ],
};

const media: Archetype = {
  names: ['media', 'media_library', 'films'],
  tables: [
    {
      name: 'titles',
      required: true,
      columns: [id, unique('title', TITLES), pick('kind', ['film', 'series']), whole('year', 1972, 2025), stamp('added_at')],
    },
    {
      name: 'episodes',
      required: true,
      columns: [
        id,
        ref('title_id', 'titles'),
        whole('season', 1, 6),
        whole('episode', 1, 12),
        pick('name', ['Pilot', 'The Return', 'Crossing', 'Old Friends', 'The Storm', 'Homecoming', 'Finale']),
        stamp('added_at'),
      ],
    },
    {
      name: 'watch_history',
      required: true,
      columns: [id, ref('user_id', 'users'), ref('title_id', 'titles'), whole('minutes', 5, 180), stamp('watched_at')],
    },
    {
      name: 'playlists',
      required: false,
      columns: [
        id,
        ref('owner_id', 'users'),
        pick('name', ['Friday night', 'Kids', 'Watch later', 'Favourites', 'Documentaries']),
        stamp('created_at'),
      ],
    },
  ],
};

const household: Archetype = {
  names: ['household', 'home', 'family'],
  tables: [
    {
      name: 'recipes',
      required: true,
      columns: [
        id,
        unique('name', RECIPES),
        whole('serves', 1, 8),
        whole('minutes', 10, 120),
        ref('added_by', 'users'),
        stamp('added_at'),
      ],
    },
    {
      name: 'bills',
      required: true,
      columns: [
        id,
        pick('payee', ['Electricity', 'Water', 'Broadband', 'Council tax', 'Home insurance', 'Mobile']),
        whole('amount_eur', 15, 400),
        ref('paid_by', 'users'),
        flag('paid', 0.8),
        stamp('due_at'),
      ],
    },
    {
      name: 'shopping_list',
      required: true,
      columns: [
        id,
        pick('item', ['Milk', 'Bread', 'Eggs', 'Coffee', 'Bin bags', 'Washing up liquid', 'Apples', 'Rice', 'Pasta']),
        whole('quantity', 1, 6),
        ref('added_by', 'users'),
        flag('bought', 0.5),
        stamp('added_at'),
      ],
    },
    {
      name: 'chores',
      required: false,
      columns: [
        id,
        pick('chore', ['Bins out', 'Hoover', 'Bathroom', 'Laundry', 'Dishes', 'Water the plants']),
        ref('assigned_to', 'users'),
        flag('done', 0.6),
        stamp('set_at'),
      ],
    },
  ],
};

const enrolment: Archetype = {
  names: ['enrolment', 'registry', 'student_records'],
  tables: [
    {
      name: 'courses',
      required: true,
      columns: [
        id,
        code('code', 'MOD', 101),
        unique('title', COURSES),
        whole('credits', 5, 30),
        ref('tutor_id', 'users'),
        stamp('created_at'),
      ],
    },
    {
      name: 'students',
      required: true,
      columns: [id, code('student_no', 'S', 240017), person('full_name'), whole('year', 1, 4), stamp('enrolled_at')],
    },
    {
      name: 'enrolments',
      required: true,
      columns: [
        id,
        ref('student_id', 'students'),
        ref('course_id', 'courses'),
        pick('grade', ['A', 'B', 'C', 'D', 'F', 'pending']),
        stamp('enrolled_at'),
      ],
    },
    {
      name: 'timetable',
      required: false,
      columns: [
        id,
        ref('course_id', 'courses'),
        pick('weekday', ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']),
        pick('starts', ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00']),
        pick('room', ['Lecture theatre A', 'Lecture theatre B', 'Lab 2', 'Seminar room 4', 'Room 101']),
      ],
    },
  ],
};

const library: Archetype = {
  names: ['library', 'catalogue', 'circulation'],
  tables: [
    {
      name: 'books',
      required: true,
      columns: [id, code('shelfmark', 'LIB-', 3100), unique('title', BOOKS), person('author'), stamp('added_at')],
    },
    {
      name: 'members',
      required: true,
      columns: [id, code('card_no', 'C', 70021), person('full_name'), stamp('joined_at')],
    },
    {
      name: 'loans',
      required: true,
      columns: [
        id,
        ref('book_id', 'books'),
        ref('member_id', 'members'),
        ref('issued_by', 'users'),
        flag('returned', 0.7),
        stamp('loaned_at'),
      ],
    },
    {
      name: 'fines',
      required: false,
      columns: [id, ref('member_id', 'members'), whole('amount_eur', 1, 20), flag('paid', 0.6), stamp('raised_at')],
    },
  ],
};

const bookings: Archetype = {
  names: ['bookings', 'room_bookings', 'reservations'],
  tables: [
    {
      name: 'rooms',
      required: true,
      columns: [id, unique('name', ROOMS), whole('capacity', 4, 120), whole('hourly_rate_eur', 0, 60), stamp('added_at')],
    },
    {
      name: 'bookings',
      required: true,
      columns: [
        id,
        ref('room_id', 'rooms'),
        person('booked_by'),
        ref('taken_by', 'users'),
        whole('hours', 1, 8),
        stamp('booked_at'),
      ],
    },
    {
      name: 'notices',
      required: true,
      columns: [
        id,
        pick('title', ['Opening hours', 'Car park closed', 'New classes', 'Lost property', 'Volunteers wanted']),
        text('body', [
          'Please see the front desk.', 'Closed on bank holidays.', 'Sign up at reception.',
          'Ask a member of staff.', 'Thank you for your patience.',
        ]),
        ref('posted_by', 'users'),
        stamp('posted_at'),
      ],
    },
    {
      name: 'events',
      required: false,
      columns: [
        id,
        ref('room_id', 'rooms'),
        pick('name', ['Coffee morning', 'Book club', 'Yoga', 'Craft fair', 'Film night', 'Coding club']),
        whole('attendees', 3, 80),
        stamp('held_at'),
      ],
    },
  ],
};

const telemetry: Archetype = {
  names: ['telemetry', 'sensors', 'home_metrics'],
  tables: [
    {
      name: 'devices',
      required: true,
      columns: [
        id,
        unique('label', DEVICES),
        pick('kind', ['thermostat', 'contact sensor', 'motion sensor', 'smart plug', 'meter', 'camera']),
        stamp('installed_at'),
      ],
    },
    {
      name: 'readings',
      required: true,
      columns: [
        id,
        ref('device_id', 'devices'),
        pick('metric', ['temperature_c', 'humidity_pct', 'power_w', 'battery_pct']),
        whole('value', 0, 100),
        stamp('read_at'),
      ],
    },
    {
      name: 'alerts',
      required: true,
      columns: [
        id,
        ref('device_id', 'devices'),
        pick('severity', ['info', 'warning', 'critical']),
        pick('message', ['Battery low', 'Went offline', 'Door left open', 'Temperature high', 'Leak detected']),
        flag('acknowledged', 0.6),
        stamp('raised_at'),
      ],
    },
    {
      name: 'automations',
      required: false,
      columns: [
        id,
        pick('name', ['Heating schedule', 'Lights at sunset', 'Away mode', 'Night mode', 'Frost guard']),
        ref('device_id', 'devices'),
        ref('created_by', 'users'),
        flag('enabled', 0.8),
        stamp('created_at'),
      ],
    },
  ],
};

const scoreboard: Archetype = {
  names: ['scoreboard', 'ctf', 'jeopardy'],
  tables: [
    {
      name: 'teams',
      required: true,
      columns: [id, unique('name', TEAMS), ref('captain_id', 'users'), stamp('founded_at')],
    },
    {
      name: 'challenges',
      required: true,
      columns: [
        id,
        unique('title', CHALLENGES),
        pick('category', ['web', 'crypto', 'pwn', 'forensics', 'reversing', 'misc']),
        whole('points', 50, 500),
        ref('author_id', 'users'),
        stamp('released_at'),
      ],
    },
    {
      name: 'solves',
      required: true,
      columns: [id, ref('team_id', 'teams'), ref('challenge_id', 'challenges'), stamp('solved_at')],
    },
    {
      name: 'hints',
      required: false,
      columns: [
        id,
        ref('challenge_id', 'challenges'),
        text('hint', ['Look at the headers.', 'Think about padding.', 'The key is short.', 'Check the timestamps.', 'Not everything is encrypted.']),
        whole('cost', 0, 100),
        stamp('added_at'),
      ],
    },
  ],
};

const wiki: Archetype = {
  names: ['wiki', 'knowledge', 'space_wiki'],
  tables: [
    {
      name: 'wiki_pages',
      required: true,
      columns: [id, unique('title', WIKI_PAGES), ref('created_by', 'users'), stamp('created_at')],
    },
    {
      name: 'revisions',
      required: true,
      columns: [
        id,
        ref('page_id', 'wiki_pages'),
        ref('author_id', 'users'),
        pick('summary', ['typo', 'added photos', 'updated steps', 'rewrote intro', 'new section', 'reverted spam']),
        stamp('edited_at'),
      ],
    },
    {
      name: 'page_tags',
      required: true,
      columns: [id, ref('page_id', 'wiki_pages'), pick('tag', ['howto', 'rules', 'hardware', 'events', 'admin', 'safety'])],
    },
    {
      name: 'comments',
      required: false,
      columns: [
        id,
        ref('page_id', 'wiki_pages'),
        ref('author_id', 'users'),
        text('body', ['Thanks, this helped.', 'Is this still true?', 'Added a note below.', 'Who has the key?', 'Updated the photo.']),
        stamp('posted_at'),
      ],
    },
  ],
};

const cms: Archetype = {
  names: ['cms', 'site_cms', 'intranet'],
  tables: [
    { name: 'categories', required: true, columns: [id, unique('name', CATEGORIES), stamp('created_at')] },
    {
      name: 'posts',
      required: true,
      columns: [
        id,
        ref('category_id', 'categories'),
        ref('author_id', 'users'),
        pick('title', ['Welcome back', 'Summer party', 'New starters', 'Office move', 'Holiday rota', 'Quarterly update', 'Fire drill']),
        pick('status', ['draft', 'published', 'archived']),
        stamp('published_at'),
      ],
    },
    {
      name: 'comments',
      required: true,
      columns: [
        id,
        ref('post_id', 'posts'),
        person('author_name'),
        text('body', ['Great news!', 'See you there.', 'Is parking available?', 'Thanks for sharing.', 'Congratulations!']),
        flag('approved', 0.8),
        stamp('posted_at'),
      ],
    },
    {
      name: 'pages',
      required: false,
      columns: [
        id,
        unique('title', ['About us', 'Contact', 'Policies', 'Staff handbook', 'Directions', 'Careers']),
        ref('author_id', 'users'),
        stamp('updated_at'),
      ],
    },
  ],
};

const api: Archetype = {
  names: ['api', 'api_platform', 'gateway'],
  tables: [
    {
      name: 'api_clients',
      required: true,
      columns: [id, unique('name', CLIENTS), ref('owner_id', 'users'), flag('active', 0.85), stamp('created_at')],
    },
    {
      name: 'request_log',
      required: true,
      columns: [
        id,
        ref('client_id', 'api_clients'),
        pick('operation', ['list_orders', 'get_order', 'create_order', 'list_customers', 'update_stock', 'health']),
        pick('status', ['200', '201', '204', '400', '401', '404', '429', '500']),
        whole('latency_ms', 4, 900),
        stamp('requested_at'),
      ],
    },
    {
      name: 'webhooks',
      required: true,
      columns: [
        id,
        ref('client_id', 'api_clients'),
        pick('event', ['order created', 'order shipped', 'stock low', 'customer updated', 'payment failed']),
        flag('active', 0.8),
        stamp('created_at'),
      ],
    },
    {
      name: 'rate_limits',
      required: false,
      columns: [id, ref('client_id', 'api_clients'), whole('per_minute', 30, 1200), whole('burst', 5, 200)],
    },
  ],
};

const mail: Archetype = {
  names: ['mail', 'maildir', 'mail_accounts'],
  tables: [
    {
      name: 'mailboxes',
      required: true,
      columns: [
        id,
        { ...ref('user_id', 'users'), nullable: true },
        column('local_part', 'VARCHAR', { kind: 'unique', values: SHARED_MAILBOXES }),
        whole('quota_mb', 256, 4096),
        flag('active', 0.9),
        stamp('created_at'),
      ],
      // One mailbox per login, and the shared ones every organisation keeps: the
      // mailboxes ARE the application's accounts, addressed on the network's zone.
      draft: ({ users, pick, pickN, nextInt }) => {
        const shared = pickN(
          SHARED_MAILBOXES.filter((local) => !users.some((user) => user.username === local)),
          nextInt(Math.max(2, 5 - users.length), 5),
        );
        const install = users[0]?.madeAt ?? 0;
        return [
          ...users.map((user) => ({
            cells: { user_id: user.id, local_part: user.username, quota_mb: pick([512, 1024, 2048]), active: 1 },
            after: user.madeAt,
          })),
          ...shared.map((local) => ({
            cells: { user_id: null, local_part: local, quota_mb: pick([1024, 2048, 4096]), active: 1 },
            after: install,
          })),
        ];
      },
    },
    {
      name: 'aliases',
      required: true,
      columns: [id, unique('alias', ALIASES), ref('mailbox_id', 'mailboxes'), stamp('created_at')],
    },
    {
      name: 'delivery_log',
      required: true,
      columns: [
        id,
        ref('mailbox_id', 'mailboxes'),
        person('sender_name'),
        pick('subject', ['Invoice attached', 'Meeting tomorrow', 'Re: quote', 'Delivery update', 'Your order', 'Minutes']),
        whole('size_kb', 2, 4800),
        stamp('delivered_at'),
      ],
    },
    {
      name: 'spam_rules',
      required: false,
      columns: [
        id,
        unique('pattern', ['free money', 'urgent invoice', 'crypto giveaway', 'verify your account', 'you have won', 'act now']),
        pick('action', ['reject', 'quarantine', 'tag']),
        whole('hits', 0, 3000),
      ],
    },
  ],
};

export const ARCHETYPE_DEFINITIONS = {
  helpdesk,
  crm,
  stock,
  till,
  media,
  household,
  enrolment,
  library,
  bookings,
  telemetry,
  scoreboard,
  wiki,
  cms,
  api,
  mail,
} as const;
