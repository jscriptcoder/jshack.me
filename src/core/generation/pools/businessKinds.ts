/**
 * The kinds of business a town keeps beyond its institutions: somewhere for coffee, a few
 * shops, and an office or two, and the clinics and dentists beside them. A kind is cheap
 * variety inside a category. It chooses how the place is named and the words its site
 * describes itself with, and nothing else: every other file on its network is its
 * category's.
 *
 * A town draws each kind by position, so reordering a list, or adding a kind anywhere but
 * the end, changes the businesses and practices of every town already declared.
 */

/** The kinds each category of business comes in. */
export const BUSINESS_SUBTYPES = {
  retail: [
    'grocer',
    'bakery',
    'pharmacy',
    'bookshop',
    'electronics',
    'hardware',
    'pawn',
    'florist',
  ],
  cafe: ['cafe', 'tea-room', 'coffee-bar'],
  corporate: ['consulting', 'logistics', 'insurance', 'it-services', 'accounting'],
} as const;

/** A category a town draws its businesses from. */
export type BusinessCategory = keyof typeof BUSINESS_SUBTYPES;

/** One kind of shop, café or office. */
export type BusinessSubtype = (typeof BUSINESS_SUBTYPES)[BusinessCategory][number];

/** The kinds of practice a town keeps beside its shops: places of care too small to be a
 *  hospital, counted apart from the businesses. */
export const PRACTICE_SUBTYPES = ['clinic', 'dentist'] as const;

/** One kind of practice. */
export type PracticeSubtype = (typeof PRACTICE_SUBTYPES)[number];

/** A kind of place a town names from a grammar: a business's or a practice's. */
export type NamedSubtype = BusinessSubtype | PracticeSubtype;

/** What kind of place a network is within its category: a business's or a practice's
 *  kind, or what a hospital is. */
export type NetworkSubtype = NamedSubtype | 'hospital';

/** How likely a business is to be each category. */
export const BUSINESS_CATEGORY_WEIGHTS: Readonly<Record<BusinessCategory, number>> = {
  cafe: 30,
  retail: 40,
  corporate: 30,
};

/**
 * How each kind of business is named: a few templates, each with one slot a word list
 * fills. A town draws them by position, so the templates and the lists below only ever
 * grow at the end, and they freeze at launch: after that a name that moved would strand
 * every note a player holds about the business.
 */
export const NAME_TEMPLATES: Readonly<Record<NamedSubtype, readonly string[]>> = {
  grocer: [
    '{filler} Market',
    '{street} Grocers',
    '{filler} Foods',
    '{street} Mini Mart',
    '{filler} Pantry',
  ],
  bakery: ["{surname}'s Bakery", '{filler} Bakehouse', '{street} Bakery'],
  pharmacy: ['{street} Pharmacy', '{surname} Chemists', '{filler} Pharmacy'],
  bookshop: ["{surname}'s Books", '{street} Bookshop', '{filler} Books'],
  electronics: ['{filler} Electronics', '{surname} Electrical', '{street} Phone Repair'],
  hardware: ['{street} Hardware', '{surname} and Sons Hardware', '{filler} Tools'],
  pawn: ["{surname}'s Pawnbrokers", '{street} Pawn', '{filler} Cash Exchange'],
  florist: ['{filler} Flowers', "{surname}'s Florist", '{street} Blooms'],
  cafe: ['{filler} Café', "{surname}'s Café", '{street} Café', 'The {filler} Kettle'],
  'tea-room': ['{filler} Tea Rooms', "{surname}'s Tea Room", 'The {filler} Teapot'],
  'coffee-bar': ['{filler} Coffee', '{street} Espresso', '{filler} Roasters'],
  consulting: ['{filler} Consulting', '{surname} and Partners', '{filler} Advisory'],
  logistics: ['{filler} Logistics', '{surname} Freight', '{street} Haulage'],
  insurance: ['{filler} Insurance', '{surname} Insurance Brokers', '{street} Mutual'],
  'it-services': ['{filler} IT Solutions', '{filler} Systems', '{surname} Computing'],
  accounting: ['{filler} Accounting', '{surname} Accountants', '{street} Tax and Accounts'],
  clinic: [
    '{street} Medical Centre',
    '{filler} Health Centre',
    '{surname} Family Practice',
    '{street} Surgery',
  ],
  dentist: [
    '{street} Dental Practice',
    '{surname} Dental Care',
    '{filler} Dental',
    '{street} Dental Surgery',
  ],
};

/** How a corporation is named: bigger than a village office, and never for a street.
 *  Drawn by position and frozen at launch, as the businesses' templates are. Two slots of
 *  one name never take the same word. */
export const CORPORATION_NAME_TEMPLATES: readonly string[] = [
  '{surname} Group',
  '{filler} Holdings',
  '{surname} & {surname}',
  '{filler} International',
];

/** The words a name template's slots are filled from. Fictional throughout. */
export const NAME_WORDS: Readonly<Record<'surname' | 'street' | 'filler', readonly string[]>> = {
  surname: [
    'Ashworth',
    'Bellamy',
    'Carver',
    'Delaney',
    'Ellison',
    'Fairbanks',
    'Garrow',
    'Hollis',
    'Iverson',
    'Jessop',
    'Kemble',
    'Lorimer',
    'Merriweather',
    'Norcross',
    'Oakley',
    'Pembroke',
    'Quayle',
    'Radley',
    'Sutcliffe',
    'Thackeray',
    'Varley',
    'Whitlock',
    'Yardley',
    'Abernethy',
  ],
  street: [
    'Main Street',
    'High Street',
    'Market Square',
    'Mill Lane',
    'Church Road',
    'Station Road',
    'Bridge Street',
    'Riverside',
    'Northgate',
    'Eastfield',
    'Westbrook',
    'Old Town',
  ],
  filler: [
    'Copper',
    'Harvest',
    'Greenleaf',
    'FreshWay',
    'Keystone',
    'Pinnacle',
    'Brightline',
    'Hearth',
    'Golden',
    'Silverbirch',
    'Oakwood',
    'Willow',
    'Bluebell',
    'Summit',
    'Evergreen',
    'Lantern',
    'Sunrise',
    'Compass',
    'Anchor',
    'Meadow',
  ],
};
