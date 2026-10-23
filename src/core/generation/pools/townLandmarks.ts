/**
 * The landmarks of every town beyond Ridgemont, written by hand as Ridgemont's catalog is:
 * fictional places from film, television and games, scaled to the town. A city keeps ten,
 * a town five and a village three; about two in three publish a site, and the rest, a
 * home, a gadget or a hacker's den, are found only by standing in the town.
 *
 * Each list is in the order its town declares it, after everything the town draws, so
 * the ORDER is load-bearing: a new landmark goes at the end of its town's list.
 */

import { entries, type EssidCatalogEntry } from './essidCatalog.js';

export const TOWN_LANDMARKS: Readonly<Record<string, readonly EssidCatalogEntry[]>> = {
  Millbrook: [
    ...entries('cafe', [
      [
        'THE-SLAUGHTERED-LAMB',
        'the Slaughtered Lamb',
        'slaughteredlamb.com',
        'The Slaughtered Lamb',
      ],
    ]),
    ...entries('retail', [
      [
        'LOCAL-SHOP-LOCAL-PEOPLE',
        'the Local Shop',
        'localshopforlocalpeople.com',
        'The Local Shop',
      ],
    ]),
    ...entries('iot', [['WRONG-TROUSERS', 'the cellar workshop']]),
  ],
  Ashby: [
    ...entries('cafe', [['THE-WOOLPACK', 'the Woolpack', 'thewoolpack.com', 'The Woolpack']]),
    ...entries('retail', [
      ['GREENDALE-POST-OFFICE', 'the post office', 'greendalepost.com', 'Greendale Post Office'],
    ]),
    ...entries('residential', [['SKELDALE-HOUSE', 'Skeldale House']]),
  ],
  Oakhurst: [
    ...entries('corporate', [['SARIF-INDUSTRIES', 'Sarif Industries', 'sarifindustries.com']]),
    ...entries('cafe', [
      ['DOUBLE-R-DINER', 'the Double R Diner', 'doublerdiner.com', 'Double R Diner'],
    ]),
    ...entries('retail', [['NOOKS-CRANNY', "Nook's Cranny", 'nookscranny.com']]),
    ...entries('residential', [['LOG-LADY-CABIN', "the Log Lady's cabin"]]),
    ...entries('iot', [['JOHNNY-5-AP', 'the garage']]),
  ],
  Kingsford: [
    ...entries('corporate', [
      ['LUMON-INDUSTRIES', 'Lumon Industries', 'lumon.com'],
      ['E-CORP-GUEST', 'E Corp', 'e-corp.com'],
      ['ENCOM-NET', 'ENCOM', 'encom.com'],
      ['REYNHOLM-INDUSTRIES', 'Reynholm Industries', 'reynholm.com'],
    ]),
    ...entries('cafe', [
      ['CENTRAL-PERK', 'Central Perk', 'centralperk.com'],
      ['LOS-POLLOS-HERMANOS', 'Los Pollos Hermanos', 'lospolloshermanos.com'],
    ]),
    ...entries('retail', [['JOJAMART', 'JojaMart', 'jojamart.com']]),
    ...entries('residential', [['221B-WIFI', 'the flat at 221B']]),
    ...entries('iot', [['HAL-9000', 'the smart speaker']]),
    ...entries('hacker', [['FSOCIETY', 'the old arcade']]),
  ],
  Fenwick: [
    ...entries('cafe', [['THE-GREEN-MAN', 'the Green Man', 'thegreenmaninn.com', 'The Green Man']]),
    ...entries('retail', [['LON-LON-RANCH', 'Lon Lon Ranch', 'lonlonranch.com']]),
    ...entries('iot', [['TALKIE-TOASTER', 'the kitchen']]),
  ],
  Thornbury: [
    ...entries('cafe', [['FAWLTY-TOWERS', 'Fawlty Towers', 'fawltytowers.com']]),
    ...entries('retail', [
      ['PIERRES-GENERAL-STORE', "Pierre's General Store", 'pierresgeneralstore.com'],
    ]),
    ...entries('hacker', [['THE-GIBSON', 'the back room']]),
  ],
  Hollowmere: [
    ...entries('cafe', [
      [
        'THE-THREE-BROOMSTICKS',
        'the Three Broomsticks',
        'threebroomsticks.com',
        'The Three Broomsticks',
      ],
    ]),
    ...entries('corporate', [
      ['JUPITER-MINING', 'Jupiter Mining Corporation', 'jupitermining.com'],
    ]),
    ...entries('residential', [['THE-BURROW', 'the Burrow']]),
  ],
  Ely: [
    ...entries('cafe', [
      ['THE-HORSE-AND-GROOM', 'the Horse and Groom', 'horseandgroom.com', 'The Horse and Groom'],
    ]),
    ...entries('retail', [['BLACK-BOOKS', 'Black Books', 'blackbooks.com']]),
    ...entries('hacker', [['DEEP-THOUGHT', 'the spare room']]),
  ],
  Wexcombe: [
    ...entries('corporate', [['INGEN-LABS', 'InGen', 'ingen.com']]),
    ...entries('cafe', [['LUKES-DINER', "Luke's Diner", 'lukesdiner.com']]),
    ...entries('retail', [['SCOOPS-AHOY', 'Scoops Ahoy', 'scoopsahoy.com']]),
    ...entries('residential', [['BAG-END', 'Bag End']]),
    ...entries('hacker', [['SETEC-ASTRONOMY', 'the warehouse']]),
  ],
  Stonebury: [
    ...entries('corporate', [['WERNHAM-HOGG', 'Wernham Hogg', 'wernhamhogg.com']]),
    ...entries('cafe', [
      ['THE-WINCHESTER', 'the Winchester', 'thewinchesterpub.com', 'The Winchester'],
    ]),
    ...entries('retail', [
      ['TROTTERS-INDEPENDENT-TRADERS', 'Trotters Independent Traders', 'trottersindependent.com'],
    ]),
    ...entries('residential', [['METEOR-STREET-FLAT', '23 Meteor Street']]),
    ...entries('hacker', [['THE-LONE-GUNMEN', "the Lone Gunmen's office"]]),
  ],
};
