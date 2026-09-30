/**
 * The homes a small town keeps beside its institutions and businesses: houses and flats
 * whose wifi is named the way people name their own, after the family, the house, or
 * nothing at all. A home publishes nothing, so nothing on the internet leads to one;
 * only the businesses that keep it running know where it is.
 *
 * A town draws its homes from this list by position, so reordering it, or adding a home
 * anywhere but the end, renames the homes of every town already declared. Every name is
 * one no Ridgemont network broadcasts. Fictional throughout.
 */

/** A home as its wifi names it, and as the people living there name the place. */
export type TownHome = readonly [essid: string, place: string];

export const TOWN_HOMES: readonly TownHome[] = [
  ['THE-HARGREAVES', "the Hargreaves' house"],
  ['ROSE-COTTAGE', 'Rose Cottage'],
  ['FLAT-2A', 'flat 2A'],
  ['OKONKWO-FAMILY', 'the Okonkwo family home'],
  ['BRAMBLE-HOUSE', 'Bramble House'],
  ['NETGEAR-7C21', 'the house on the corner'],
  ['THE-OLD-RECTORY', 'the Old Rectory'],
  ['KOWALSKI-WIFI', "the Kowalskis' house"],
  ['GARDEN-FLAT', 'the garden flat'],
  ['WILLOW-VIEW', 'Willow View'],
  ['THE-NGUYENS', "the Nguyens' house"],
  ['LINKSYS-B3E0', 'the terraced house'],
  ['PEAR-TREE-HOUSE', 'Pear Tree House'],
  ['BARN-CONVERSION', 'the barn conversion'],
];
