/**
 * What a phone or tablet keeps that no other box does: the models a household's tablet
 * may be. A phone's model is the share's (`PHONE_MODELS`), because file servers, media
 * boxes and locks already name it; nothing else on a network names a tablet, so its
 * range lives here, where only the tablet's own storage reads it.
 */

/** The tablets a household buys. The maker decides which storage the tablet keeps, so an
 *  iPad keeps an iPhone's and every other tablet an android's. */
export const TABLET_MODELS: readonly { readonly make: string; readonly model: string }[] = [
  { make: 'Apple', model: 'iPad (9th generation)' },
  { make: 'Apple', model: 'iPad Air (5th generation)' },
  { make: 'Apple', model: 'iPad mini (6th generation)' },
  { make: 'Apple', model: 'iPad Pro (11-inch)' },
  { make: 'Samsung', model: 'Galaxy Tab S8' },
  { make: 'Samsung', model: 'Galaxy Tab A8' },
  { make: 'LENOVO', model: 'Lenovo Tab P11' },
  { make: 'Amazon', model: 'Fire HD 10' },
];
