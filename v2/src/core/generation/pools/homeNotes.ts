/**
 * The notes a person keeps under `~/notes`, grouped by the kind of place the network is.
 *
 * Authored wide on purpose: a player who breaks into a dozen desktops reads a dozen
 * homes, and a note they have read before turns the rest into furniture. Variety comes
 * from the templates AND from the slots each fills per home, so two people in one office
 * write different notes even from the same template.
 *
 * Each template names its own file, so two notes in one home never share a name. Slots:
 * `{place}` the network's own name for itself, `{first}` the inhabitant's first name,
 * `{colleague}` somebody else there, `{date}` a day before the world's epoch, `{day}` a
 * weekday, `{time}` an hour, `{count}` a small number.
 *
 * Rules every body keeps, because the tests hold the output to them: no software version
 * (a bare decimal reads as one), no password written down, and no machine name (machines
 * are named in code, from the network's real population, never in a template).
 */

import type { NetworkCategory } from './essidCatalog';

export type NoteTemplate = { readonly file: string; readonly body: string };

/** People an inhabitant names in their notes — first names only, never a machine. */
export const COLLEAGUES: readonly string[] = [
  'Priya', 'Tom', 'Aiko', 'Dave', 'Marisol', 'Kwame', 'Lotte', 'Ravi', 'Sunny', 'Beth',
  'Oleg', 'Nkechi', 'Hamid', 'Carmen', 'Gus', 'Ines', 'Mona', 'Yuna', 'Frank', 'Delia',
];

export const WEEKDAYS: readonly string[] = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

export const TIMES: readonly string[] = [
  '7am', '8am', '9am', '10am', '11am', 'noon', '2pm', '3pm', '4pm', '5pm', '6pm', '9pm',
];

export const NOTE_TEMPLATES: Readonly<Record<NetworkCategory, readonly NoteTemplate[]>> = {
  corporate: [
    { file: 'standup.md', body: 'standup {date}\n- yesterday: the {place} deck, again\n- today: review {colleague} changes\n- blocked: nobody knows who owns the old intranet\n' },
    { file: 'todo.txt', body: 'before {day}\n[ ] expenses, the {place} portal logs me out every time\n[x] book the room for {time}\n[ ] reply to {colleague}\n' },
    { file: 'one-on-one.md', body: '1:1 with {colleague}, {date}\n- wants the migration done this quarter\n- offsite still has no budget from {place}\n\n-- {first}\n' },
    { file: 'all-hands.md', body: '{place} all-hands {date}\n- reorg "not happening" (it is happening)\n- free lunch on {day} is cancelled\n- Q&A ran {count} minutes over\n' },
    { file: 'onboarding.md', body: 'welcome to {place}\n1. laptop from IT\n2. join the team channel\n3. the wiki is out of date, ask {colleague}\n' },
    { file: 'ideas.txt', body: 'things {place} should build and never will\n- a coffee machine status page\n- meeting-free {day}s\n- an alert that beats {colleague} to the red build\n' },
    { file: 'review.md', body: 'self review {date}\nwins: shipped the reporting rewrite, mentored {colleague}\ngrowth: "communicate earlier", every year at {place}\n\n-- {first}\n' },
    { file: 'handover.md', body: 'on-call handover {date}\n{count} pages this week, mostly the same flaky alert.\nsilenced until {day}. {colleague} knows the history.\n' },
    { file: 'lunch.txt', body: 'lunch {day} ({place} pays, allegedly)\n{colleague}: noodles, no coriander\n{first}: whatever is quickest\n' },
    { file: 'release.md', body: 'release checklist\n[ ] freeze merges at {time}\n[ ] tell {place} support what changed\n[ ] watch dashboards until {colleague} says it is fine\n' },
    { file: 'contacts.txt', body: 'people at {place} who actually answer\nfacilities: {colleague}\nIT: open a ticket, then message {colleague} anyway\n' },
    { file: 'offsite.md', body: 'offsite planning {date}\nvenue: still arguing\ndates: a {day} next month\n{colleague} wants escape rooms, I want to stay at {place}\n' },
  ],
  cafe: [
    { file: 'rota.txt', body: 'rota week of {date}\n{day}: me opening at {time}\n{colleague}: close\n' },
    { file: 'orders.txt', body: 'supplier order for {place}\n- oat milk x{count}\n- the large cups\n- the good beans, not the cheap ones {colleague} ordered\n' },
    { file: 'menu.md', body: 'new menu for {place}\n- cardamom bun, test batch {day}\n- something iced for summer\n- drop the quinoa salad\n\n-- {first}\n' },
    { file: 'regulars.txt', body: 'regulars at {place}\nlaptop one: flat white, by the socket for {count} hours\nthe knitting club: {day}s at {time}\n' },
    { file: 'wifi.txt', body: 'what customers say about the {place} wifi\n- "is it down"\n- "it asked for a code"\ntold {colleague} to restart the router. again.\n' },
    { file: 'closing.md', body: 'closing checklist, {place}\n[ ] descale the machine on {day}s\n[ ] count the till\n[ ] lock the back door, {colleague}\n' },
    { file: 'events.txt', body: 'open mic at {place} {date}\n{count} signed up, {colleague} hosting\nremember the extension lead this time\n' },
    { file: 'till.txt', body: 'till was {count} short on {day}\nprobably the refund {colleague} did at {time}\nwrote it in the book at {place}\n\n-- {first}\n' },
    { file: 'playlist.txt', body: 'shop playlist for {place}\nnothing before {time} louder than jazz\n{colleague} keeps adding the same album\n' },
    { file: 'staff.md', body: 'staff meeting {date}\n- new card machine {day}\n- bake less on quiet days\n- {colleague} is training the new starter at {place}\n' },
    { file: 'shopping.txt', body: 'after shift\n- bike light\n- card for {colleague}\n- more of that {place} tea to take home\n' },
    { file: 'rent.txt', body: 'rent due {day}\nshifts at {place} this month: {count}\nask {colleague} about swapping the late ones\n' },
  ],
  residential: [
    { file: 'groceries.txt', body: 'groceries\n- eggs\n- bread\n- coffee, the strong one\n- something for dinner {day}, {colleague} is coming to {place}\n' },
    { file: 'bills.txt', body: 'bills at {place}\nelectricity: due {date}\ninternet: check the direct debit went out\nwater: split with {colleague}\n' },
    { file: 'chores.md', body: 'chores at {place}\n- {first}: bins on {day}\n- {colleague}: bathroom\n- everyone: stop leaving mugs in the living room\n' },
    { file: 'recipe.txt', body: 'the dal {colleague} made at {place}\n- lentils, rinse twice\n- onion, garlic, ginger, tin of tomatoes\n- simmer {count} minutes then the spices\n' },
    { file: 'wishlist.txt', body: 'wishlist\n- decent headphones\n- a plant that survives\n- shelves for the hallway at {place}\n- the book {colleague} mentioned\n' },
    { file: 'landlord.txt', body: 'to tell the landlord about {place}\n1. the boiler makes the noise again\n2. damp in the bedroom corner\n\n-- {first}\n' },
    { file: 'party.md', body: 'party at {place} {date}\ninvited {count}, expecting twice that\n{colleague} bringing speakers\nwarn the neighbours before {time}\n' },
    { file: 'budget.txt', body: 'budget this month\nrent at {place}: paid\nfood: over, again\nsavings: {count} a week if I stop buying lunch\n' },
    { file: 'appointments.txt', body: 'dentist {day} {time}\ncar service {date}\n{colleague} birthday, get a card\n' },
    { file: 'schoolrun.txt', body: 'school run rota\n{day}: me\nother days: {colleague}\nswimming at {time}, bag by the door at {place}\n' },
    { file: 'moving.md', body: 'move out of {place}?\npros: cheaper, nearer work\ncons: {colleague} lives round the corner\ndecide by {date}\n\n-- {first}\n' },
    { file: 'garden.txt', body: 'garden at {place}\n- tomatoes out after the last frost\n- {colleague} borrowed the shears\n- water every {day} if it has not rained\n' },
  ],
  university: [
    { file: 'thesis.md', body: 'thesis outline\n1. intro\n2. related work, {count} papers still to read\n3. method\nmeeting {colleague} at {place} on {day}\n\n-- {first}\n' },
    { file: 'deadlines.txt', body: 'deadlines\n- problem set {day} {time}\n- lab report {date}\n- reading group at {place}, bring questions\n' },
    { file: 'lecture.md', body: 'lecture {date}\nmissed the first {count} minutes, ask {colleague}\nkey idea: everything is a graph if you squint\n' },
    { file: 'reading.txt', body: 'reading list\n- the survey {colleague} keeps citing\n- chapter {count} of the textbook\n- anything that explains the {place} lab code\n' },
    { file: 'project.md', body: 'group project\n{colleague}: slides\nme: the code\nmeet {day} {time} at {place}\n' },
    { file: 'lablog.txt', body: 'lab log {date}\nrun {count} crashed at the same step.\nchanged nothing, ran it again, worked. do not trust it.\n' },
    { file: 'supervisor.md', body: 'meeting {colleague} {date}\n- "a good start" (it is not)\n- draft by {day}\n- travel grant through {place}\n\n-- {first}\n' },
    { file: 'dorm.txt', body: 'rules at {place}\n- quiet after {time}\n- no candles\n- {colleague} is the floor rep\n' },
    { file: 'exam.md', body: 'exam prep\n{count} past papers to do\nstudy group {day} at {place}\nsleep more than {colleague}\n' },
    { file: 'hours.txt', body: 'office hours at {place}\n{day} {time}\nmost common question: "is this on the exam"\n{colleague} covers when I am away\n' },
    { file: 'intern.md', body: 'internship applications\nsent: {count}\nheard back: 0\nask {colleague} about the cover letter before {date}\n' },
    { file: 'money.txt', body: 'student budget\ncoffee at {place}: too much\ntextbooks: borrow from {colleague}\nnoodles: plenty\n' },
  ],
  public: [
    { file: 'commute.txt', body: 'commute\n- the {time} is always late\n- {place} is quicker if I get off a stop early\n- {colleague} saw a fox on the platform\n' },
    { file: 'library.txt', body: 'books out from {place}\n- due back {date}\n- renew online if I remember how\n- {colleague} wants the next one after me\n' },
    { file: 'volunteer.md', body: 'volunteering at {place}\n{day}s at {time}\nbring the sign-in sheet\n{colleague} runs the rota\n\n-- {first}\n' },
    { file: 'trip.md', body: 'trip {date}\n- passport, check it is in date\n- charger\n- leave by {time}, {place} gets busy\n- text {colleague} when I land\n' },
    { file: 'jobs.txt', body: 'job search from {place}, home has no signal\napplied: {count}\ninterview {day} {time}\nask {colleague} for a reference\n' },
    { file: 'whatson.txt', body: 'what is on at {place}\n- local history talk {day}\n- craft fair {date}\n- {colleague} says the film night is good\n' },
    { file: 'lost.txt', body: 'left my umbrella at {place} on {day}\nasked the desk, {colleague} said check back after {time}\n' },
    { file: 'errands.txt', body: 'errands\n- post office before {time}\n- print the forms at {place}\n- return {colleague} charger\n' },
    { file: 'feedback.txt', body: 'feedback for {place}\nthe wifi drops every {count} minutes and the entrance chargers do not work.\n{colleague} agrees.\n\n-- {first}\n' },
    { file: 'weekend.md', body: 'weekend\n{day}: meet {colleague} at {place} {time}\nthen the market\nSunday: nothing at all\n' },
    { file: 'books.txt', body: 'reading at {place}\n- finished the crime one\n- started the one {colleague} lent me\n- {count} pages a day, that is the deal\n' },
    { file: 'times.txt', body: 'times from {place}\nfirst: {time}\nlast: earlier than you think\n{colleague} says {day} is reduced\n' },
  ],
  iot: [
    { file: 'setup.txt', body: 'setting up the thing in {place}\n- plugged it in\n- the app wanted an account, made one\n- {colleague} says never update it, it forgets the schedule\n' },
    { file: 'schedule.txt', body: 'schedule for {place}\n{day}s: on at {time}\naway mode from {date}\nask {colleague} to check on it\n' },
    { file: 'manual.md', body: 'notes from the manual\n- reset: hold the button {count} seconds\n- blinks blue when it lost the network\n- lives in {place}, the cable does not reach elsewhere\n\n-- {first}\n' },
    { file: 'shopping.txt', body: 'for {place}\n- filters, the {count}-pack\n- a longer cable\n- batteries, AA, not the ones {colleague} bought\n' },
    { file: 'problems.txt', body: 'problems with the one in {place}\n{date}: stopped responding\n{day}: started again on its own\n{colleague} thinks it is haunted\n' },
    { file: 'energy.txt', body: 'electricity since the {place} thing\nbefore: bad\nafter: slightly less bad\nworth it? ask {colleague} on {day}\n' },
    { file: 'automation.md', body: 'automation ideas\n- {place} lights on at {time}\n- notify me when the door opens\n- stop it talking to the cloud, somehow\n\n-- {first}\n' },
    { file: 'warranty.txt', body: 'warranty for the {place} unit\nbought {date}\n{count} years cover, keep the box\n{colleague} has the receipt\n' },
    { file: 'wifi.txt', body: 'the thing in {place} keeps dropping off wifi\n- moved the router\n- {count}th reset this week\n- {colleague} says buy a different brand\n' },
    { file: 'guests.md', body: 'guest notes for {place}\n- the app is on the tablet by the door\n- lights auto-off at {time}\n- text {colleague} if anything beeps\n' },
    { file: 'todo.txt', body: 'home stuff\n[ ] name the {place} device something sensible\n[ ] turn off the microphone\n[ ] ask {colleague} how theirs is set up\n' },
    { file: 'log.txt', body: '{place} log\n{day}: firmware "improved" everything, broke the schedule\nrolled nothing back, there is no back\n\n-- {first}\n' },
  ],
  hacker: [
    { file: 'projects.md', body: 'projects at {place}\n- the badge for next {day}\n- rewrite the wiki nobody reads\n- {colleague} still owes me a soldering iron\n\n-- {first}\n' },
    { file: 'todo.txt', body: 'todo\n[ ] restock the {place} fridge\n[ ] {count} boxes of resistors\n[ ] fix the label printer, or ask {colleague}\n' },
    { file: 'meetup.md', body: 'meetup {date}\ntalk: {colleague} on lockpicking\nbring: the projector, snacks\nstarts {time}, doors at {place} before that\n' },
    { file: 'inventory.txt', body: '{place} inventory\n- {count} spare keyboards\n- the oscilloscope {colleague} fixed\n- a bin of cables nobody will ever sort\n' },
    { file: 'ctf.md', body: 'ctf {date}\nteam: me, {colleague}, whoever shows up at {place}\nweak on crypto, strong on caffeine\nkickoff {time}\n' },
    { file: 'rules.txt', body: 'house rules at {place}\n- label your food\n- no sleeping under the {day} workbench\n- ask {colleague} before touching the laser\n' },
    { file: 'wishlist.txt', body: 'wishlist for {place}\n- a decent 3d printer\n- more of the {count}mm bolts\n- the tool {colleague} keeps borrowing, times two\n' },
    { file: 'network.md', body: 'network notes for {place}\n- guest ssid for {day} events\n- the printer is on a vlan of its own now\n- {colleague} has the layout in their head, get it written down\n' },
    { file: 'talks.txt', body: 'talk ideas\n- how the {place} door lock works (badly)\n- {colleague} on retro consoles\n- {count} things I learned the hard way\n' },
    { file: 'budget.txt', body: '{place} budget\ndues cover rent, barely\nmembers this month: {count}\nask {colleague} about the grant\n' },
    { file: 'log.md', body: '{place} log {date}\n{day}: someone left the soldering iron on\nno harm done, new sign up\n\n-- {first}\n' },
    { file: 'ideas.txt', body: 'random ideas at {time}\n- a plant watering rig for {place}\n- a doorbell that pages the channel\n- talk {colleague} out of the flamethrower one\n' },
  ],
};
