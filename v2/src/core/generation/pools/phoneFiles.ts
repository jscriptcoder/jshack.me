/**
 * What a phone or tablet keeps that no other box does: the models a household's tablet
 * may be. A phone's model is the share's (`PHONE_MODELS`), because file servers, media
 * boxes and locks already name it; nothing else on a network names a tablet, so its
 * range lives here, where only the tablet's own storage reads it.
 */

import type { NetworkCategory } from './essidCatalog';

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

/** A PDF a device kept: its file name and its title, either of which may carry a `{ref}`
 *  slot, the booking or account number the issuer stamped on it. */
export type DownloadSpec = { readonly name: string; readonly title: string };

/** What a person saves from their inbox or a website, each credited in its Info dictionary
 *  to the organisation that made it. Every issuer is invented. Titles and authors stay
 *  ASCII, because `strings` breaks a run at the first character above it. */
export const PERSONAL_DOWNLOADS: readonly (DownloadSpec & { readonly author: string })[] = [
  { name: 'boarding-pass-{ref}.pdf', title: 'Boarding pass {ref}', author: 'Skyline Air' },
  { name: 'e-ticket-{ref}.pdf', title: 'E-ticket {ref}', author: 'Northline Rail' },
  { name: 'invoice-{ref}.pdf', title: 'Invoice {ref}', author: 'Brightwave Broadband' },
  { name: 'energy-bill-{ref}.pdf', title: 'Your energy bill', author: 'Northwind Energy' },
  { name: 'payslip-{ref}.pdf', title: 'Payslip', author: 'Ledgerline Payroll Services' },
  { name: 'tenancy-agreement.pdf', title: 'Tenancy agreement', author: 'Keystone Lettings' },
  { name: 'dishwasher-manual.pdf', title: 'Dishwasher user manual', author: 'Arden Appliances' },
  { name: 'quick-start-guide.pdf', title: 'Quick start guide', author: 'Netlink Systems' },
  { name: 'tickets-{ref}.pdf', title: 'Your tickets', author: 'StageDoor Tickets' },
  { name: 'order-{ref}.pdf', title: 'Order confirmation {ref}', author: 'Parcelly' },
  { name: 'statement-{ref}.pdf', title: 'Statement of account', author: 'Harbour Bank' },
  { name: 'membership-terms.pdf', title: 'Membership terms', author: 'Iron Works Gym' },
  { name: 'banana-bread.pdf', title: 'Banana bread', author: 'The Home Kitchen' },
  { name: 'insurance-{ref}.pdf', title: 'Certificate of motor insurance', author: 'Meridian Motor Insurance' },
  { name: 'vet-invoice-{ref}.pdf', title: 'Treatment invoice', author: 'Riverside Vets' },
  { name: 'newsletter.pdf', title: 'Spring newsletter', author: 'Hollybrook Primary School' },
  { name: 'booking-{ref}.pdf', title: 'Booking confirmation {ref}', author: 'Harbourview Hotel' },
  { name: 'warranty-{ref}.pdf', title: 'Warranty registration', author: 'Arden Appliances' },
  { name: 'council-tax-{ref}.pdf', title: 'Council tax bill', author: 'Borough Council' },
  { name: 'appointment-letter.pdf', title: 'Appointment letter', author: 'Greenfields Medical Practice' },
];

/** The paperwork a kind of place hands its people, which somebody on the network wrote. */
export const PLACE_DOWNLOADS: Readonly<Record<NetworkCategory, readonly DownloadSpec[]>> = {
  corporate: [
    { name: 'expenses-policy.pdf', title: 'Expenses policy' },
    { name: 'org-chart.pdf', title: 'Organisation chart' },
    { name: 'all-hands-{ref}.pdf', title: 'All-hands slides' },
  ],
  cafe: [
    { name: 'rota-week-{ref}.pdf', title: 'Staff rota' },
    { name: 'menu.pdf', title: 'Menu' },
    { name: 'allergens.pdf', title: 'Allergen information' },
  ],
  residential: [
    { name: 'house-rules.pdf', title: 'House rules' },
    { name: 'bin-days.pdf', title: 'Bin collection days' },
  ],
  university: [
    { name: 'timetable-{ref}.pdf', title: 'Timetable' },
    { name: 'lab-safety.pdf', title: 'Lab safety induction' },
  ],
  public: [
    { name: 'opening-hours.pdf', title: 'Opening hours' },
    { name: 'whats-on-{ref}.pdf', title: 'What is on this month' },
  ],
  iot: [
    { name: 'device-list.pdf', title: 'Devices in the house' },
    { name: 'maintenance-log.pdf', title: 'Maintenance log' },
  ],
  hacker: [
    { name: 'membership-rules.pdf', title: 'Membership rules' },
    { name: 'workshop-schedule.pdf', title: 'Workshop schedule' },
  ],
};
