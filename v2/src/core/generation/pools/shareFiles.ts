/**
 * What a department share holds, by the kind of place it serves.
 *
 * Each kind of place keeps its own departments, and each department its own files: a
 * café's share holds menus and rotas, a family's NAS its paperwork and photos. The
 * names and bodies are authored, never drawn letter by letter, so every one reads as
 * something a person saved. Nothing here names a credential or a version: a share is
 * where an organisation keeps its work, not its keys.
 */

import type { NetworkCategory } from './essidCatalog';

export type ShareFileSpec =
  | { readonly name: string; readonly format: 'pdf'; readonly title: string }
  | { readonly name: string; readonly format: 'jpeg' }
  | { readonly name: string; readonly format: 'docx' | 'xlsx' }
  | { readonly name: string; readonly format: 'text'; readonly body: string };

type Folders = Readonly<Record<string, readonly ShareFileSpec[]>>;

export const SHARE_FOLDERS: Readonly<Record<NetworkCategory, Folders>> = {
  corporate: {
    finance: [
      { name: 'q2-budget.pdf', format: 'pdf', title: 'Q2 budget' },
      { name: 'expenses-march.xlsx', format: 'xlsx' },
      { name: 'invoice-log.csv', format: 'text', body: 'invoice,supplier,amount,paid\n' },
    ],
    hr: [
      { name: 'holiday-policy.pdf', format: 'pdf', title: 'Holiday policy' },
      { name: 'onboarding-checklist.docx', format: 'docx' },
      { name: 'org-chart.pdf', format: 'pdf', title: 'Organisation chart' },
    ],
    legal: [
      { name: 'nda-template.docx', format: 'docx' },
      { name: 'supplier-contract.pdf', format: 'pdf', title: 'Supplier contract' },
      { name: 'README.md', format: 'text', body: '# Legal\n\nSigned copies only.\n' },
    ],
    sales: [
      { name: 'pipeline.xlsx', format: 'xlsx' },
      { name: 'price-list.pdf', format: 'pdf', title: 'Price list' },
      { name: 'trade-show.jpg', format: 'jpeg' },
    ],
    it: [
      { name: 'asset-register.xlsx', format: 'xlsx' },
      { name: 'acceptable-use.pdf', format: 'pdf', title: 'Acceptable use policy' },
      { name: 'printer-setup.txt', format: 'text', body: 'Add the printer from Settings.\n' },
    ],
    marketing: [
      { name: 'brand-guidelines.pdf', format: 'pdf', title: 'Brand guidelines' },
      { name: 'launch-photo.jpg', format: 'jpeg' },
      { name: 'newsletter-draft.docx', format: 'docx' },
    ],
    facilities: [
      { name: 'fire-drill.pdf', format: 'pdf', title: 'Fire drill procedure' },
      { name: 'desk-plan.pdf', format: 'pdf', title: 'Desk plan' },
      { name: 'cleaning-rota.csv', format: 'text', body: 'day,area,who\n' },
    ],
  },
  cafe: {
    menus: [
      { name: 'spring-menu.pdf', format: 'pdf', title: 'Spring menu' },
      { name: 'specials.docx', format: 'docx' },
      { name: 'allergens.pdf', format: 'pdf', title: 'Allergen information' },
    ],
    rota: [
      { name: 'rota.xlsx', format: 'xlsx' },
      { name: 'rota-this-week.csv', format: 'text', body: 'day,open,close\n' },
      { name: 'holiday-requests.txt', format: 'text', body: 'Put your dates here.\n' },
    ],
    suppliers: [
      { name: 'suppliers.xlsx', format: 'xlsx' },
      { name: 'milk-order.pdf', format: 'pdf', title: 'Standing milk order' },
      { name: 'contacts.txt', format: 'text', body: 'Bakery delivers before seven.\n' },
    ],
    invoices: [
      { name: 'invoice-0412.pdf', format: 'pdf', title: 'Invoice' },
      { name: 'invoice-0419.pdf', format: 'pdf', title: 'Invoice' },
      { name: 'takings.xlsx', format: 'xlsx' },
    ],
    inspections: [
      { name: 'hygiene-report.pdf', format: 'pdf', title: 'Food hygiene inspection' },
      { name: 'fridge-temps.csv', format: 'text', body: 'date,fridge,temp\n' },
      { name: 'cleaning-schedule.docx', format: 'docx' },
    ],
    photos: [
      { name: 'counter.jpg', format: 'jpeg' },
      { name: 'new-sign.jpg', format: 'jpeg' },
      { name: 'latte-art.jpg', format: 'jpeg' },
    ],
  },
  residential: {
    paperwork: [
      { name: 'tenancy-agreement.pdf', format: 'pdf', title: 'Tenancy agreement' },
      { name: 'car-insurance.pdf', format: 'pdf', title: 'Car insurance schedule' },
      { name: 'passport-renewal.txt', format: 'text', body: 'Photos, form, old passport.\n' },
    ],
    taxes: [
      { name: 'tax-return.pdf', format: 'pdf', title: 'Tax return' },
      { name: 'receipts.xlsx', format: 'xlsx' },
      { name: 'notes.txt', format: 'text', body: 'Ask about the home office.\n' },
    ],
    house: [
      { name: 'boiler-manual.pdf', format: 'pdf', title: 'Boiler manual' },
      { name: 'kitchen-quote.pdf', format: 'pdf', title: 'Kitchen quote' },
      { name: 'garden.jpg', format: 'jpeg' },
    ],
    school: [
      { name: 'term-dates.pdf', format: 'pdf', title: 'Term dates' },
      { name: 'science-project.docx', format: 'docx' },
      { name: 'reading-log.txt', format: 'text', body: 'Chapter four tonight.\n' },
    ],
    photos: [
      { name: 'beach.jpg', format: 'jpeg' },
      { name: 'birthday.jpg', format: 'jpeg' },
      { name: 'dog.jpg', format: 'jpeg' },
    ],
    recipes: [
      { name: 'lasagne.txt', format: 'text', body: 'Brown the mince first.\n' },
      { name: 'banana-bread.pdf', format: 'pdf', title: 'Banana bread' },
      { name: 'meal-plan.xlsx', format: 'xlsx' },
    ],
  },
  university: {
    research: [
      { name: 'draft-paper.pdf', format: 'pdf', title: 'Draft paper' },
      { name: 'results.csv', format: 'text', body: 'run,value\n' },
      { name: 'lab-notes.md', format: 'text', body: '# Lab notes\n\nRepeat the second run.\n' },
    ],
    theses: [
      { name: 'thesis-draft.pdf', format: 'pdf', title: 'Thesis draft' },
      { name: 'chapter-three.docx', format: 'docx' },
      { name: 'feedback.txt', format: 'text', body: 'Tighten the method section.\n' },
    ],
    lectures: [
      { name: 'week-one.pdf', format: 'pdf', title: 'Week one' },
      { name: 'reading-list.docx', format: 'docx' },
      { name: 'attendance.xlsx', format: 'xlsx' },
    ],
    admin: [
      { name: 'room-bookings.xlsx', format: 'xlsx' },
      { name: 'exam-timetable.pdf', format: 'pdf', title: 'Exam timetable' },
      { name: 'staff-list.txt', format: 'text', body: 'Office hours on the door.\n' },
    ],
    grants: [
      { name: 'proposal.pdf', format: 'pdf', title: 'Grant proposal' },
      { name: 'budget.xlsx', format: 'xlsx' },
      { name: 'report.docx', format: 'docx' },
    ],
  },
  public: {
    minutes: [
      { name: 'minutes-march.pdf', format: 'pdf', title: 'Meeting minutes' },
      { name: 'minutes-april.docx', format: 'docx' },
      { name: 'agenda.txt', format: 'text', body: 'Apologies, minutes, any other business.\n' },
    ],
    planning: [
      { name: 'site-plan.pdf', format: 'pdf', title: 'Site plan' },
      { name: 'consultation.docx', format: 'docx' },
      { name: 'site-visit.jpg', format: 'jpeg' },
    ],
    notices: [
      { name: 'opening-hours.pdf', format: 'pdf', title: 'Opening hours' },
      { name: 'closure-notice.docx', format: 'docx' },
      { name: 'events.txt', format: 'text', body: 'Craft morning on Saturday.\n' },
    ],
    budgets: [
      { name: 'annual-budget.xlsx', format: 'xlsx' },
      { name: 'budget-summary.pdf', format: 'pdf', title: 'Budget summary' },
      { name: 'grants.csv', format: 'text', body: 'grant,amount,status\n' },
    ],
    maintenance: [
      { name: 'repairs.xlsx', format: 'xlsx' },
      { name: 'roof-survey.pdf', format: 'pdf', title: 'Roof survey' },
      { name: 'boiler.jpg', format: 'jpeg' },
    ],
  },
  hacker: {
    talks: [
      { name: 'lightning-talk.pdf', format: 'pdf', title: 'Lightning talk' },
      { name: 'schedule.md', format: 'text', body: '# Talks\n\nSlots are ten minutes.\n' },
      { name: 'stage.jpg', format: 'jpeg' },
    ],
    zines: [
      { name: 'issue-one.pdf', format: 'pdf', title: 'Issue one' },
      { name: 'issue-two.pdf', format: 'pdf', title: 'Issue two' },
      { name: 'submissions.txt', format: 'text', body: 'Plain text, under a page.\n' },
    ],
    writeups: [
      { name: 'badge-teardown.md', format: 'text', body: '# Badge teardown\n\nFour screws.\n' },
      { name: 'soldering-guide.pdf', format: 'pdf', title: 'Soldering guide' },
      { name: 'ctf-notes.txt', format: 'text', body: 'We came third.\n' },
    ],
    meetups: [
      { name: 'attendance.csv', format: 'text', body: 'date,people\n' },
      { name: 'code-of-conduct.pdf', format: 'pdf', title: 'Code of conduct' },
      { name: 'pizza-order.xlsx', format: 'xlsx' },
    ],
    photos: [
      { name: 'workbench.jpg', format: 'jpeg' },
      { name: 'meetup.jpg', format: 'jpeg' },
      { name: 'badge.jpg', format: 'jpeg' },
    ],
  },
  iot: {
    datasheets: [
      { name: 'controller-datasheet.pdf', format: 'pdf', title: 'Controller datasheet' },
      { name: 'sensor-datasheet.pdf', format: 'pdf', title: 'Sensor datasheet' },
      { name: 'pinout.txt', format: 'text', body: 'Ground is the square pad.\n' },
    ],
    qa: [
      { name: 'test-log.csv', format: 'text', body: 'unit,result\n' },
      { name: 'defects.xlsx', format: 'xlsx' },
      { name: 'board.jpg', format: 'jpeg' },
    ],
    certification: [
      { name: 'declaration-of-conformity.pdf', format: 'pdf', title: 'Declaration of conformity' },
      { name: 'test-report.pdf', format: 'pdf', title: 'Radio test report' },
      { name: 'label.jpg', format: 'jpeg' },
    ],
    manuals: [
      { name: 'user-manual.pdf', format: 'pdf', title: 'User manual' },
      { name: 'quick-start.pdf', format: 'pdf', title: 'Quick start guide' },
      { name: 'install-notes.docx', format: 'docx' },
    ],
  },
};

/** The cameras a photo on a share was taken with. Each name stands alone in a `strings`
 *  listing, so every one is at least four characters, and none carries a decimal. */
export const CAMERAS: readonly { readonly make: string; readonly model: string }[] = [
  { make: 'Canon', model: 'Canon EOS R6' },
  { make: 'NIKON CORPORATION', model: 'NIKON Z 6' },
  { make: 'FUJIFILM', model: 'X-T4' },
];
