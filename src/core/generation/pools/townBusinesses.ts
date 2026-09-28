/**
 * The businesses a small town keeps beyond its institutions: somewhere for coffee,
 * somewhere for groceries, and an office or two. Each name is the business's own and
 * reads the way a sign over its door would, so the site, the wifi and the domain are
 * all spelt from it.
 *
 * A town draws its businesses from this list by position, so reordering it, or adding
 * a name anywhere but the end, renames the businesses of every town already declared.
 * Fictional throughout, like the catalog's crackable networks.
 */

import type { NetworkCategory } from './essidCatalog.js';

export type TownBusiness = readonly [category: NetworkCategory, name: string];

export const TOWN_BUSINESSES: readonly TownBusiness[] = [
  // Cafés: the site offers coffee, food, opening hours and free wifi.
  ['cafe', 'Copper Kettle'],
  ['cafe', 'Hearth & Grain'],
  ['cafe', 'Daily Grind'],
  ['cafe', 'Bean Counter'],
  ['cafe', 'Tipsy Teapot'],
  ['cafe', 'Crumbs Bakery'],
  // Grocers: the site sells groceries and household essentials.
  ['retail', 'Corner Pantry'],
  ['retail', 'Harvest Market'],
  ['retail', 'Greenleaf Grocers'],
  ['retail', 'Main Street Mini Mart'],
  ['retail', 'FreshWay Foods'],
  // Small offices: the site offers products, services, careers and news.
  ['corporate', 'Brightline Consulting'],
  ['corporate', 'Keystone Logistics'],
  ['corporate', 'Northgate Insurance'],
  ['corporate', 'Pinnacle IT Solutions'],
  ['corporate', 'Riverside Accounting'],
];
