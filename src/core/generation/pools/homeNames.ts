/**
 * How a town names its homes: houses and flats whose wifi is named the way people name
 * their own, after the family, after the house, by the flat's number, or not at all,
 * under the name the router came with. A home publishes nothing, so nothing on the
 * internet leads to one; only the businesses that keep it running know where it is.
 *
 * A town draws a home's form by weight, then one of the form's templates, then the word
 * its slot takes, each by position, so the templates and the lists below only ever grow
 * at the end, and they freeze at launch. Fictional throughout.
 */

/** The ways a home is named. */
export type HomeForm = 'family' | 'house' | 'flat' | 'default';

/** How likely a home is to be named each way. */
export const HOME_FORM_WEIGHTS: Readonly<Record<HomeForm, number>> = {
  family: 35,
  house: 30,
  flat: 15,
  default: 20,
};

/**
 * A home's name, as its wifi spells it and as the people living there name the place.
 * The wifi is spelt from the first as a business's is: upper case, words joined by
 * hyphens. A slot is filled with the same word in both: `{surname}` from the homes'
 * surnames, `{surnames}` the family they make (a surname ending in "s" takes no more),
 * `{plant}` and `{description}` from their lists, `{flat}` a floor 1–9 and a door A–D,
 * and `{hex}` four hex digits.
 */
export type HomeTemplate = readonly [essid: string, place: string];

/** Each form's templates. Every place reads after "at": "bills at Rose Cottage". */
export const HOME_TEMPLATES: Readonly<Record<HomeForm, readonly HomeTemplate[]>> = {
  family: [
    ['The {surnames}', "the {surnames}' house"],
    ['{surname} Family', 'the {surname} family home'],
    ['{surname} WiFi', "the {surnames}' house"],
  ],
  house: [
    ['{plant} Cottage', '{plant} Cottage'],
    ['{plant} House', '{plant} House'],
    ['{plant} View', '{plant} View'],
    ['{plant} Lodge', '{plant} Lodge'],
    ['The Old Rectory', 'the Old Rectory'],
    ['Barn Conversion', 'the barn conversion'],
    ['The Granary', 'the Granary'],
    ['The Old Forge', 'the Old Forge'],
    ['The Coach House', 'the Coach House'],
    ['The Old Dairy', 'the Old Dairy'],
  ],
  flat: [
    ['Flat {flat}', 'flat {flat}'],
    ['Garden Flat', 'the garden flat'],
    ['Top Flat', 'the top flat'],
    ['Basement Flat', 'the basement flat'],
  ],
  default: [
    ['NETGEAR {hex}', '{description}'],
    ['LINKSYS {hex}', '{description}'],
    ['TP-LINK {hex}', '{description}'],
    ['BT-HUB {hex}', '{description}'],
  ],
};

/** The words a home's slots are filled from. None is a word a business is named with, so
 *  no home reads as the family behind a shop, nor Willow View as kin to Willow Insurance. */
export const HOME_WORDS: Readonly<Record<'surname' | 'plant' | 'description', readonly string[]>> =
  {
    surname: [
      'Hargreaves',
      'Okonkwo',
      'Kowalski',
      'Nguyen',
      'Adeyemi',
      'Bianchi',
      'Brennan',
      'Castillo',
      'Doherty',
      'Fitzgerald',
      'Gallagher',
      'Haddad',
      'Jankowski',
      'Mahoney',
      'Moreau',
      'Novak',
      'Patel',
      'Petrov',
      'Quigley',
      'Rossi',
      'Sandoval',
      'Takahashi',
      'Usman',
      'Zielinski',
      'Achebe',
      'Delgado',
      'Eriksen',
      'Fraser',
      'Lindqvist',
      'Murphy',
      'Osei',
      'Reilly',
    ],
    plant: [
      'Rose',
      'Bramble',
      'Pear Tree',
      'Willow',
      'Ivy',
      'Holly',
      'Laurel',
      'Rowan',
      'Hawthorn',
      'Lilac',
      'Honeysuckle',
      'Primrose',
      'Magnolia',
      'Cherry Tree',
      'Apple Tree',
      'Foxglove',
      'Heather',
      'Lavender',
      'Jasmine',
      'Wisteria',
      'Beech',
      'Elm',
      'Hazel',
      'Clover',
    ],
    description: [
      'the house on the corner',
      'the terraced house',
      'the end terrace',
      'the bungalow',
      'the semi with the blue door',
      'the house with the red door',
      'the cottage by the green',
      'the farmhouse',
      'the house at the end of the lane',
      'the converted chapel',
      'the house by the bridge',
      'the townhouse',
      'the house behind the hedge',
      'the house opposite the pub',
      'the new build',
      'the house with the long drive',
      'the house by the allotments',
      'the house with the solar panels',
      'the cottage up the hill',
      'the house by the level crossing',
      'the detached house',
      'the house with the green gate',
      'the house with the conservatory',
      'the house with the pond',
    ],
  };
