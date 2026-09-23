/**
 * What the people on a network write to each other about, as data.
 *
 * Two layers. A network is one organisation, so most of its mail is the business that
 * organisation is in — the same business its database and its store already describe, so
 * a player who has read the till's takings recognises the argument about them. The rest
 * is the ordinary traffic of a place where people sit near each other: the kettle, a
 * parcel, a lift home. That layer is keyed by the KIND of place rather than by its
 * software, because a café and a hackerspace chat differently even when neither has a
 * database at all.
 *
 * Every line here is inert and self-contained. No body holds a credential, a word from
 * any password pool, a version, a path, or an address — an address is written by the
 * generator, on the network's own zone, and never typed here. Where a thread names
 * something the world holds, it names something the databases really keep: a company the
 * CRM has a row for, a challenge the scoreboard scores, a page the wiki carries.
 *
 * A thread's replies are IN ORDER: the first answers the opener, the second answers that.
 * A thread that runs to two messages uses the first alone, so every prefix has to read as
 * a finished exchange.
 */

import type { NetworkCategory } from './essidCatalog';
import type { NetworkArchetypeKey } from '../databaseApp';

export type MailThreadSpec = {
  readonly subject: string;
  /** Three to five lines. The person who opens the thread writes these. */
  readonly opener: readonly string[];
  /** Answers in order, one to three lines each. */
  readonly replies: readonly (readonly string[])[];
};

/** The business of each application a network can run. Keyed by the archetype the
 *  network drew, so every box on it talks about the same organisation. */
export const MAIL_SPECS: Readonly<Record<NetworkArchetypeKey, readonly MailThreadSpec[]>> = {
  helpdesk: [
    {
      subject: 'The queue this week',
      opener: [
        'We closed eleven tickets and opened nine, so the queue is nearly flat.',
        'The oldest one open is the wall mount in the meeting room.',
        'I would rather clear that than start anything new.',
      ],
      replies: [
        ['Clear it. The mount is a twenty minute job if somebody brings the drill.'],
        ['Drill is in the cupboard by the lift. I will do it before the stand-up.'],
      ],
    },
    {
      subject: 'The shared printer again',
      opener: [
        'The printer on the second floor has stopped taking jobs from anyone.',
        'It answers when you ping it and then does nothing with the queue.',
        'I have turned it off at the wall and back on twice.',
      ],
      replies: [
        [
          'Clear the queue on the server rather than the device.',
          'It gets stuck on a job somebody cancelled halfway through.',
        ],
        ['That was it. Six jobs waiting behind a dead one. All printing now.'],
        ['Noting it on the ticket so the next person does not power cycle it for an hour.'],
      ],
    },
    {
      subject: 'Kit for the new starter',
      opener: [
        'Somebody starts on Monday and there is nothing set aside for them.',
        'We have the spare laptop from the leaver, which needs wiping.',
        'A second screen would help if there is one going.',
      ],
      replies: [
        ['There are two screens under the stairs. Take the bigger one.'],
        ['Laptop is wiped and the account is made. Screen is on the desk.'],
      ],
    },
    {
      subject: 'Access requests are piling up',
      opener: [
        'Four people are waiting on access to the shared drive.',
        'Two of them asked a fortnight ago and chased me this morning.',
        'I can do them all in one go if somebody confirms who should have it.',
      ],
      replies: [
        ['Everyone in the request list is fine except the contractor. Leave that one.'],
        ['Done, and I have told the contractor to ask their manager first.'],
      ],
    },
    {
      subject: 'Out of hours cover',
      opener: [
        'Nobody is down for the bank holiday weekend.',
        'It is usually quiet, but the last one had a call out on the Sunday.',
        'I will take the Saturday if somebody takes the Sunday.',
      ],
      replies: [
        ['I will take the Sunday. I am around anyway.'],
        ['Both down on the rota. Thank you, the pair of you.'],
      ],
    },
    {
      subject: 'The meeting room screen',
      opener: [
        'The screen in the meeting room shows nothing for half the laptops that try it.',
        'It works from the two older machines and from nothing newer.',
        'I think we need a different cable rather than a different screen.',
      ],
      replies: [
        ['Order two cables and keep one in the drawer. They walk off.'],
        ['Ordered. They come Thursday.'],
      ],
    },
  ],
  crm: [
    {
      subject: 'Harbour Logistics renewal',
      opener: [
        'Harbour Logistics comes up for renewal at the end of next month.',
        'They have been quiet all quarter, which usually means they are shopping around.',
        'I would rather call them than send another letter.',
      ],
      replies: [
        ['Call them. Ask about the second site before you talk about price.'],
        ['Called. They want the same terms and an earlier invoice date. I have said yes.'],
      ],
    },
    {
      subject: 'Call notes from Tuesday',
      opener: [
        'I have written up Tuesday into the record so it is not just in my notebook.',
        'Short version: they are happy, they want more of the same, and they want it sooner.',
        'Nothing in it needs a decision this week.',
      ],
      replies: [
        ['Read it. Nothing to add, except that their new buyer starts in the spring.'],
        ['Added that to the account so whoever calls next knows.'],
      ],
    },
    {
      subject: 'Two deals stuck at proposal',
      opener: [
        'Kestrel Engineering and Oakline Furniture have both sat at proposal for weeks.',
        'Neither has said no, and neither will say yes without a nudge.',
        'Shall I close them off or chase once more?',
      ],
      replies: [
        ['Chase once more, then close them. A proposal that old is not a deal.'],
        ['Kestrel answered within the hour. Oakline is closed.'],
      ],
    },
    {
      subject: 'The contact list is out of date',
      opener: [
        'Half the people I rang this week have left the companies they are listed under.',
        'One of them has been gone two years.',
        'I can work through it, but it needs a morning of nobody interrupting me.',
      ],
      replies: [
        ['Take Friday morning. It is worth more than the calls you would have made.'],
        ['Worked through the top forty. Twelve were wrong.'],
      ],
    },
    {
      subject: 'Who owns the Redfern account',
      opener: [
        'Redfern Motors rang and asked for whoever handles them.',
        'The record has one name on it and that person says it is not theirs.',
        'Somebody needs to own it before they ring again.',
      ],
      replies: [
        ['I will take it. I know the site and I have met the manager.'],
        ['Changed on the record. Thank you.'],
      ],
    },
    {
      subject: 'Quote for Bluebell Florists',
      opener: [
        'Bluebell Florists want a quote broken down by month rather than in one number.',
        'The total is the same either way, they just want to see it laid out.',
        'I can send it tomorrow if nobody objects to showing the breakdown.',
      ],
      replies: [
        ['No objection. They are going to ask for it eventually anyway.'],
        ['Sent. They came back the same afternoon.'],
      ],
    },
  ],
  stock: [
    {
      subject: 'Pallet wrap is nearly out',
      opener: [
        'We are down to two rolls of pallet wrap and the count says eleven.',
        'Either the count is wrong or somebody has taken a box off the shelf.',
        'Either way we need more before the end of the week.',
      ],
      replies: [
        ['Order a box and I will recount the aisle on Friday.'],
        ['Recounted. The shelf label was on the wrong bay, so the count was reading the ties.'],
      ],
    },
    {
      subject: 'Stock count on Friday',
      opener: [
        'The count is Friday, starting when the morning van has gone.',
        'Two people on the back aisle and two on the racking is enough.',
        'Anything picked after we start goes on paper, not on the scanner.',
      ],
      replies: [
        ['I will take the racking. Bring the long ladder round the night before.'],
        ['Ladder is round. Paper pad is on the desk by the door.'],
      ],
    },
    {
      subject: 'Damaged delivery this morning',
      opener: [
        'Four boxes came in crushed on one corner this morning.',
        'The tape was cut and retaped on two of them, which I have photographed.',
        'I have signed for it as damaged rather than refusing the lot.',
      ],
      replies: [
        ['That is the right call. Send the photographs over and I will claim for the four.'],
        ['Claim is in. They are sending replacements with the next run.'],
      ],
    },
    {
      subject: 'The scanner keeps dropping',
      opener: [
        'The barcode scanner at the back door loses its connection every few minutes.',
        'It comes back on its own, but you lose whatever you were part way through.',
        'It is worse when the shutter is open, which might be nothing or might be everything.',
      ],
      replies: [
        ['Swap it with the one from the office and see if the fault follows the scanner.'],
        ['Swapped. The fault stayed at the back door, so it is the door and not the scanner.'],
      ],
    },
    {
      subject: 'Shelf bins for the back aisle',
      opener: [
        'The small parts in the back aisle are still in the boxes they arrived in.',
        'Half of them have split and the labels are on the floor.',
        'A run of shelf bins would pay for itself in a fortnight of not hunting.',
      ],
      replies: [
        ['Agreed. Order enough for the whole aisle rather than half of it.'],
        ['Ordered. They arrive Tuesday and I will label them as they go up.'],
      ],
    },
    {
      subject: 'Overtime for the count',
      opener: [
        'The count will run past five if we only have four people on it.',
        'Two hours each should finish it rather than leaving it half done.',
        'Tell me now if you cannot stay and I will move somebody.',
      ],
      replies: [
        ['I can stay. I would rather finish it than come back to it on Monday.'],
        ['Same here.'],
      ],
    },
  ],
  till: [
    {
      subject: 'The takings did not balance',
      opener: [
        'Saturday was eleven euros light against the till roll.',
        'I have counted it twice and got the same answer both times.',
        'Nothing looks wrong on the roll itself, so I think it is a miskey.',
      ],
      replies: [
        ['It is almost always a miskey on a round number. Leave it and note it.'],
        ['Noted. Sunday balanced to the euro, so I am not worried about it.'],
      ],
    },
    {
      subject: 'Almond croissants gone by ten',
      opener: [
        'We sold out of almond croissants before ten again on Saturday.',
        'That is the third weekend running.',
        'Two more trays would sell, and if they do not we eat them.',
      ],
      replies: [
        ['Order two more for Saturday only. Weekdays are fine as they are.'],
        ['Done. Saturday only.'],
      ],
    },
    {
      subject: 'Shift swap for Saturday',
      opener: [
        'I am away this Saturday and I am down for the morning.',
        'It is the early one, so whoever takes it is finished by two.',
        'I will take a Sunday in exchange, any Sunday you like.',
      ],
      replies: [
        ['I will take it. Put me down for your Sunday at the end of the month.'],
        ['Swapped on the rota. Thank you.'],
      ],
    },
    {
      subject: 'New tea on the board',
      opener: [
        'The peppermint has been selling better than everything else on the tea list.',
        'We could put a second herbal on and see whether it goes the same way.',
        'It costs us nothing to try it for a month.',
      ],
      replies: [
        ['Try it. Chalk it on the board rather than reprinting the menu.'],
        ['On the board since Monday. Selling slowly but steadily.'],
      ],
    },
    {
      subject: 'The card machine is slow',
      opener: [
        'The card machine takes an age to connect at the start of the day.',
        'Once it is going it is fine, but the first customer waits a minute.',
        'Turning it on before we open would hide it, if nobody has a better idea.',
      ],
      replies: [
        ['Turn it on when you come in and leave it. It only sleeps overnight.'],
        ['That works. Nobody has waited since.'],
      ],
    },
    {
      subject: 'The milk order is wrong again',
      opener: [
        'We got half the milk we ordered and twice the cream.',
        'That is twice this month from the same supplier.',
        'I have moved the cream to the back and we will use it in the cakes.',
      ],
      replies: [
        ['Ring them rather than emailing. They do not read the emails.'],
        ['Rang them. The standing order had the two lines the wrong way round.'],
      ],
    },
  ],
  media: [
    {
      subject: 'The list for film night',
      opener: [
        'I have put six on the list for Friday and we can vote on the night.',
        'Two of them are long, so if either wins we start earlier.',
        'Shout if there is something you want on the list.',
      ],
      replies: [
        ['Add the one about the coast. I have been meaning to watch it for a year.'],
        ['Added. Seven now, which is plenty.'],
      ],
    },
    {
      subject: 'Subtitles are out of step',
      opener: [
        'The subtitles on half the library run about two seconds ahead.',
        'It is only on the older files, which were all added at the same time.',
        'They are watchable, just annoying.',
      ],
      replies: [
        ['It is the files rather than the player. They were all made from the same source.'],
        ['I will redo the ones we actually watch and leave the rest.'],
      ],
    },
    {
      subject: 'Running out of room',
      opener: [
        'The drive is nearly full and half of it is things nobody has opened in a year.',
        'I do not want to delete anything without asking.',
        'If you have something on there you care about, say so this week.',
      ],
      replies: [
        ['Keep the series. Everything else can go as far as I am concerned.'],
        ['Cleared about a third. Series untouched.'],
      ],
    },
    {
      subject: 'Who renamed everything',
      opener: [
        'Every title in the library has been renamed to the same pattern.',
        'It is tidier, I will admit that, but now nothing I had bookmarked resolves.',
        'Was that deliberate?',
      ],
      replies: [
        ['That was me. I should have said. The old names had four different styles in them.'],
        ['Fair enough. It does look better. I will redo my bookmarks.'],
      ],
    },
    {
      subject: 'The Long Harbour is worth an evening',
      opener: [
        'I watched The Long Harbour at the weekend and it is much better than it looks.',
        'Slow for the first half hour and then it picks up.',
        'It is on the shelf if anybody wants it.',
      ],
      replies: [
        ['Took it. You were right about the first half hour.'],
        ['Everyone says that and everyone finishes it.'],
      ],
    },
    {
      subject: 'The remote has gone again',
      opener: [
        'The remote is not in the room, not down the sofa and not in the kitchen.',
        'This is the third time this month.',
        'If somebody has it upstairs, bring it down and no questions asked.',
      ],
      replies: [
        ['It was in the washing basket. I have no explanation.'],
        ['I am going to put a hook on the wall for it.'],
      ],
    },
  ],
  household: [
    {
      subject: 'Bins go out tonight',
      opener: [
        'Bins tonight, and it is the recycling as well as the ordinary one.',
        'The lorry has been coming early all month.',
        'Whoever is up last, please put them at the end of the path.',
      ],
      replies: [
        ['Done. Both out and the lids shut this time.'],
        ['Thank you. They came at half six.'],
      ],
    },
    {
      subject: 'The boiler is making a noise',
      opener: [
        'The boiler has started clicking for a minute or so before it fires.',
        'It is heating the water fine, so it is a noise rather than a fault yet.',
        'Worth getting somebody out before it gets cold.',
      ],
      replies: [
        ['Ring the person who came last year rather than finding somebody new.'],
        ['Booked for a week on Tuesday. He says the clicking is usually the ignition.'],
      ],
    },
    {
      subject: 'Shopping list for the week',
      opener: [
        'I am going tomorrow morning. The list so far is bread, milk, eggs and coffee.',
        'Add anything you want by tonight and I will pick it up.',
        'I am not buying biscuits again, so do not ask.',
      ],
      replies: [
        ['Washing powder, and the good coffee rather than the cheap one.'],
        ['Got everything. The good coffee was on offer, so there are two.'],
      ],
    },
    {
      subject: 'Somebody left the tap running',
      opener: [
        'The tap in the bathroom was left running most of yesterday afternoon.',
        'No harm done, the plug was out, but that is a lot of water.',
        'Please check it if you are the last one out.',
      ],
      replies: [
        ['That was me and I am sorry. I will check from now on.'],
        ['No harm. It happens.'],
      ],
    },
    {
      subject: 'Curtain rail in the back room',
      opener: [
        'The curtain rail in the back room has come away from the wall at one end.',
        'It is holding on the other three screws, but it will not hold long.',
        'I can fix it if somebody holds the other end.',
      ],
      replies: [
        ['I can hold it on Sunday morning.'],
        ['Fixed, and I have put longer screws in the whole rail while I was there.'],
      ],
    },
    {
      subject: 'Thursday is lentil soup',
      opener: [
        'I am doing lentil soup on Thursday and there will be more than enough.',
        'Tell me if you are in so I know how much bread to get.',
        'It keeps, so nothing is wasted either way.',
      ],
      replies: [
        ['I am in. I will bring the bread.'],
        ['Then we are five. Plenty.'],
      ],
    },
  ],
  enrolment: [
    {
      subject: 'Registration closes Friday',
      opener: [
        'Registration closes at five on Friday and around thirty have not finished it.',
        'Most of them have started and stopped halfway through.',
        'A reminder on Wednesday usually moves two thirds of them.',
      ],
      replies: [
        ['Send it Wednesday morning. Afternoon reminders get read on Monday.'],
        ['Sent. Down to nine by this morning.'],
      ],
    },
    {
      subject: 'Two on the wrong course',
      opener: [
        'Two students have been sitting in Databases for a fortnight and are enrolled on Networks.',
        'Both say they were told to swap and nobody wrote it down.',
        'I would rather fix the record than argue about who said what.',
      ],
      replies: [
        ['Fix the record. Backdate it to the start of term so their marks carry.'],
        ['Done, both of them, backdated.'],
      ],
    },
    {
      subject: 'Timetable clash',
      opener: [
        'Statistics and Linear Algebra are both down for Tuesday at eleven.',
        'Around forty students are on both, so somebody has to move.',
        'There is a free slot on Thursday afternoon that would take either.',
      ],
      replies: [
        ['Move Statistics. The room is bigger on Thursday and the lecturer is free.'],
        ['Moved. The students have been told twice, which will not be enough.'],
      ],
    },
    {
      subject: 'Late enrolments',
      opener: [
        'Four have asked to enrol after the deadline, all for the same reason.',
        'Their funding came through late, which is not their fault.',
        'The rule says no and the reason says yes.',
      ],
      replies: [
        ['Take all four. The rule is there for people who forgot, not for this.'],
        ['Enrolled. I have noted why on each one so nobody queries it later.'],
      ],
    },
    {
      subject: 'Room for the induction talk',
      opener: [
        'We have outgrown the usual room for the induction talk.',
        'Last year people stood at the back and could not hear.',
        'The main hall is free that morning if we book it now.',
      ],
      replies: [
        ['Book it. Standing at the back is how we lose people in the first week.'],
        ['Booked, with the microphone, which is the part that actually matters.'],
      ],
    },
    {
      subject: 'Reading list is too long',
      opener: [
        'The reading list for the first term has grown to thirty titles.',
        'The library has four copies of most of them.',
        'Nobody reads thirty, so we are really asking them to guess which six matter.',
      ],
      replies: [
        ['Mark six as required and leave the rest as further reading.'],
        ['Marked. The library has ordered more of the six.'],
      ],
    },
  ],
  library: [
    {
      subject: 'Overdue notices',
      opener: [
        'The overdue list has grown to about seventy items.',
        'A third of them are from the same handful of borrowers.',
        'A polite notice clears most of it without anybody having to ring.',
      ],
      replies: [
        ['Send the notices. Ring only the ones that are a month over.'],
        ['Sent. Twenty back within the week, which is the usual rate.'],
      ],
    },
    {
      subject: 'The reservation shelf is full',
      opener: [
        'The reservation shelf has run out of room and things are stacked on the end.',
        'Some have been waiting more than a month for somebody who is not coming.',
        'A fortnight would be a fairer hold.',
      ],
      replies: [
        ['A fortnight, and a notice the day before it goes back.'],
        ['Changed. The shelf has room again.'],
      ],
    },
    {
      subject: 'A History of Rivers has gone missing',
      opener: [
        'A History of Rivers is down as on the shelf and is not on the shelf.',
        'It has not been issued since the spring.',
        'I have looked along the whole run twice in case it is shelved wrong.',
      ],
      replies: [
        ['Check the reading room. Things end up there and come back a month later.'],
        ['It was in the reading room, under a newspaper. Back on the shelf.'],
      ],
    },
    {
      subject: 'Opening on Saturdays',
      opener: [
        'We have been asked again about opening on Saturday mornings.',
        'Three hours would cover most of what people say they want.',
        'It needs two of us, so it only works if somebody else is willing.',
      ],
      replies: [
        ['I would do one Saturday a month, not every week.'],
        ['One a month is enough to start. First Saturday, from ten.'],
      ],
    },
    {
      subject: 'The donations from the sale',
      opener: [
        'The sale left us with about forty donated books.',
        'Maybe a dozen are worth shelving and the rest are worn out.',
        'I do not want to throw them away without saying so first.',
      ],
      replies: [
        ['Shelve the dozen. The rest can go to the charity shop rather than the bin.'],
        ['Taken over this morning. They were pleased with them.'],
      ],
    },
    {
      subject: 'The photocopier',
      opener: [
        'The photocopier jams on anything thicker than ordinary paper.',
        'It has done it since it was moved, which may be a coincidence.',
        'People have started asking us to do their copies, which is not a solution.',
      ],
      replies: [
        ['Get somebody out to look at it. Moving it may have knocked the tray out of true.'],
        ['The tray was out of true. It has not jammed since.'],
      ],
    },
  ],
  bookings: [
    {
      subject: 'Main hall on the twelfth',
      opener: [
        'Somebody wants the main hall on the twelfth for most of the day.',
        'The choir has the evening, which we cannot move.',
        'It works if the day booking finishes by five and clears the chairs.',
      ],
      replies: [
        ['Take it on those terms and put the chair clearing in writing.'],
        ['Booked, finishing at five, chairs back on the rack.'],
      ],
    },
    {
      subject: 'Double booking in the studio',
      opener: [
        'The studio is down twice for Thursday evening.',
        'One was taken over the phone and never written in.',
        'Both have been told it is theirs, which is my fault.',
      ],
      replies: [
        ['Offer the later one the garden room and something off the price.'],
        ['They took the garden room and were fine about it. Phone bookings go in the book now.'],
      ],
    },
    {
      subject: 'Keys for the garden room',
      opener: [
        'The garden room key has not come back from the group that had it in the spring.',
        'They have finished their run, so it is not in use.',
        'We have one spare, which is not really enough.',
      ],
      replies: [
        ['Ring them once, then get two more cut and change the routine.'],
        ['They found it in a bag. Two more cut anyway.'],
      ],
    },
    {
      subject: 'Deposit for the choir',
      opener: [
        'The choir has asked whether they can pay the deposit at the end of the month.',
        'They have used us for years and have never missed a payment.',
        'I am inclined to say yes and note it.',
      ],
      replies: [
        ['Say yes. They are the least of our worries.'],
        ['Said yes. They have booked the whole autumn as well.'],
      ],
    },
    {
      subject: 'Chairs for Saturday',
      opener: [
        'Saturday needs about eighty chairs and we have sixty out.',
        'The rest are stacked in the store and two of the stacks are wobbling.',
        'Somebody should check them before they are carried through a full room.',
      ],
      replies: [
        ['I will go through the stacks on Friday and pull anything cracked.'],
        ['Pulled four. Seventy six good ones, which is enough.'],
      ],
    },
    {
      subject: 'The cancellation rule',
      opener: [
        'We have had three late cancellations this month and kept nothing.',
        'A week of notice would be reasonable and is what everywhere else asks.',
        'I do not want to be hard about it with the regular groups.',
      ],
      replies: [
        ['A week, and the regulars get one forgiven a year.'],
        ['Written up and going on the form.'],
      ],
    },
  ],
  telemetry: [
    {
      subject: 'The hallway thermostat reads high',
      opener: [
        'The hallway thermostat has been reading about two degrees above the room all week.',
        'The landing one agrees with a thermometer, so it is that sensor rather than the heating.',
        'It is enough to keep the heating off when it should be on.',
      ],
      replies: [
        ['It is in the sun for part of the afternoon. Move it along the wall and see.'],
        ['Moved a foot down the hall. It agrees with the landing now.'],
      ],
    },
    {
      subject: 'The porch camera keeps dropping off',
      opener: [
        'The porch camera disappears for an hour or two most evenings.',
        'It comes back on its own and the recordings for that window are simply missing.',
        'Everything else out there stays up, so it is not the whole end of the house.',
      ],
      replies: [
        ['That is when the kitchen is busy. It may be the microwave more than the camera.'],
        ['Changed the channel it uses and it has not dropped since.'],
      ],
    },
    {
      subject: 'Battery in the loft sensor',
      opener: [
        'The loft humidity sensor has been warning about its battery for a fortnight.',
        'It is still reporting, so there is no hurry, but it will stop eventually.',
        'It is an awkward one to reach, so it is worth doing the others at the same time.',
      ],
      replies: [
        ['Do all four while the ladder is up. They went in together so they will go out together.'],
        ['All four done. Noted the date so we are not guessing next time.'],
      ],
    },
    {
      subject: 'A gap in the readings overnight',
      opener: [
        'There are no readings at all between about two and four on Tuesday morning.',
        'Every sensor stops and every sensor starts again together.',
        'That points at the hub rather than at any of them.',
      ],
      replies: [
        ['The hub restarts itself when it runs out of memory. It has done it before.'],
        ['Gave it a fixed restart at three so at least the gap is where we expect it.'],
      ],
    },
    {
      subject: 'The boiler meter numbers',
      opener: [
        'The boiler meter is reporting about a third more than last winter for the same weather.',
        'The readings themselves look sensible, so it is not a broken sensor.',
        'Either the boiler is working harder or we are heating the place longer.',
      ],
      replies: [
        ['We put the timer forward an hour in the autumn and never put it back.'],
        ['That is it. Put back, and the numbers are where they were within a week.'],
      ],
    },
    {
      subject: 'Too many alerts',
      opener: [
        'Everything sends an alert for everything and nobody reads any of them now.',
        'The door sensors alone are dozens a day, which is just people using the door.',
        'I would rather be told about the leak sensor and nothing else.',
      ],
      replies: [
        ['Leave the leak sensor and the smoke one on. Turn the rest down to a daily summary.'],
        ['Done. Two alerts this week and both worth reading.'],
      ],
    },
  ],
  scoreboard: [
    {
      subject: 'Scores for baby rop',
      opener: [
        'Eleven teams have baby rop down as solved and two of those look identical.',
        'Same approach, same timing, within a minute of each other.',
        'It might be nothing. People do sit together.',
      ],
      replies: [
        ['They were sitting together. I watched them do it.'],
        ['Then it is nothing. Leaving both scores as they are.'],
      ],
    },
    {
      subject: 'byte club are disputing a flag',
      opener: [
        'byte club say their submission on the vault challenge was rejected twice and then accepted.',
        'They want the earlier timestamp, which would put them second rather than fourth.',
        'The log shows two rejections, so something did happen.',
      ],
      replies: [
        [
          'The first two had a trailing space. That is our fault for not trimming it.',
          'Give them the earlier time.',
        ],
        ['Given, and submissions are trimmed now so it cannot happen again.'],
      ],
    },
    {
      subject: 'A new challenge for next month',
      opener: [
        'We need one more challenge for next month and nothing in the middle range.',
        'Everything we have is either an hour or a whole evening.',
        'Something around twenty minutes would let people finish one before they go home.',
      ],
      replies: [
        ['I have half of one written. Give me a week and somebody to test it.'],
        ['Tested it. Took me twenty five minutes, which is about right.'],
      ],
    },
    {
      subject: 'The locked vault is too hard',
      opener: [
        'Nobody has solved the locked vault and it has been up for three weeks.',
        'Two teams got most of the way and stopped in the same place.',
        'A hint after the first week would keep people trying.',
      ],
      replies: [
        ['Add a hint that costs points rather than making the challenge easier.'],
        ['Hint is up. Three solves in two days, all of them taking the hint.'],
      ],
    },
    {
      subject: 'Prize for the winners',
      opener: [
        'We have enough in the kitty for something for the top three.',
        'Last time it was the same mug that everyone already has.',
        'Open to suggestions that are not mugs.',
      ],
      replies: [
        ['Put it towards the tool the workshop has been asking for and name it after the winners.'],
        ['That went down better than any mug ever has.'],
      ],
    },
    {
      subject: 'Submissions timing out',
      opener: [
        'Submissions time out whenever more than about twenty go in together.',
        'It happens at the top of the hour, which is when everyone tries.',
        'Nothing is lost, but people submit three times and then complain.',
      ],
      replies: [
        ['Queue them rather than answering straight away, and tell people it is queued.'],
        ['Queued. Nobody has noticed, which is the idea.'],
      ],
    },
  ],
  wiki: [
    {
      subject: 'The cleaning rota is out of date',
      opener: [
        'The cleaning rota page still has three people who left last year on it.',
        'The rest of us have been quietly doing their weeks.',
        'I have rewritten it with who is actually here.',
      ],
      replies: [
        ['Thank you. Put the bin night on it as well, since that is the bit people forget.'],
        ['Added. It is one page now instead of two half pages.'],
      ],
    },
    {
      subject: 'The soldering station page',
      opener: [
        'The soldering station page describes the old iron and the old extractor.',
        'Somebody following it would set the temperature far too high.',
        'I can rewrite it, but I want to be sure nobody is using the old one on purpose.',
      ],
      replies: [
        ['Nobody is. The old iron went in the spring.'],
        ['Rewritten, with the temperatures for both the fine and the heavy tips.'],
      ],
    },
    {
      subject: 'Door access for new members',
      opener: [
        'Three new members have joined and none of them can get in on their own yet.',
        'The page on door access is written for whoever sets it up, not for them.',
        'They need four lines rather than four paragraphs.',
      ],
      replies: [
        ['Write the four lines at the top and leave the rest below for the rest of us.'],
        ['Done. All three have been in at the weekend without asking anybody.'],
      ],
    },
    {
      subject: 'Signing tools out',
      opener: [
        'Two of the good clamps have not come back and nobody signed for them.',
        'The tool library page says to sign, and clearly nobody reads it.',
        'A board on the wall by the shelf would work better than a page.',
      ],
      replies: [
        ['Put the board up. Keep the page for what we own rather than who has it.'],
        ['Board is up. Both clamps came back the same week, no questions asked.'],
      ],
    },
    {
      subject: 'Meeting notes from last week',
      opener: [
        'Notes from last week are up, a bit rough in the middle where I stopped typing.',
        'The decisions are all there even if the discussion is not.',
        'Correct anything I got wrong rather than telling me about it.',
      ],
      replies: [
        ['Fixed two things about the budget. Everything else matched what I remember.'],
        ['Thank you. That is exactly what the page is for.'],
      ],
    },
    {
      subject: 'The rack in the corner',
      opener: [
        'The rack page has not been touched since the rack was built.',
        'Two of the machines on it are not there any more and one new one is missing.',
        'It would take twenty minutes with the door open and a notebook.',
      ],
      replies: [
        ['I will do it on Sunday. Somebody hold the door, it swings shut.'],
        ['Updated, with a photograph so the next person can see what is where.'],
      ],
    },
  ],
};

/** The traffic of any place where people sit near each other, keyed by the kind of place
 *  rather than by what it runs. A café and a hackerspace chat differently. */
export const PERSONAL_THREADS: Readonly<Record<NetworkCategory, readonly MailThreadSpec[]>> = {
  corporate: [
    {
      subject: 'Lunch',
      opener: [
        'Anybody going out for lunch, or is it sandwiches at the desk again?',
        'I am going about one whatever anybody else does.',
      ],
      replies: [
        ['I am in. Give me ten minutes to finish this.'],
        ['Waiting by the lift.'],
      ],
    },
    {
      subject: 'Parcel at the front desk',
      opener: [
        'There is a parcel at the front desk with your name on it.',
        'It has been there since yesterday morning.',
        'It is heavy, so bring somebody with you or a trolley.',
      ],
      replies: [
        ['Collected, and it was books. I have no memory of ordering books.'],
        ['That is the best kind of parcel.'],
      ],
    },
    {
      subject: 'The kettle has died',
      opener: [
        'The kettle made a noise this morning and has not worked since.',
        'It is about six years old, so it owes us nothing.',
        'Collecting for a new one, and a decent one this time.',
      ],
      replies: [
        ['Put me down. Get the one that turns itself off properly.'],
        ['Ordered. It comes Thursday and it is the good one.'],
      ],
    },
    {
      subject: 'Leaving do on Friday',
      opener: [
        'Friday after work for the leaving do, at the place on the corner.',
        'They have a table for us from six.',
        'Tell me by Wednesday so I can tell them a number.',
      ],
      replies: [
        ['I am there. Can I bring somebody?'],
        ['Bring who you like. I have said twelve and they have room.'],
      ],
    },
    {
      subject: 'The blind in the corner',
      opener: [
        'The blind by the corner desk has been stuck up for a fortnight.',
        'Whoever sits there gets the sun straight in the face until about eleven.',
        'It needs somebody taller than me and the right screwdriver.',
      ],
      replies: [
        ['I will look at it at lunchtime. It is usually the cord off the roller.'],
        ['It was the cord. Down and up again as it should be.'],
      ],
    },
    {
      subject: 'Chairs from the old floor',
      opener: [
        'There are a dozen chairs on the old floor that nobody has claimed.',
        'Four of them are better than what most of us are sitting on.',
        'Take one before they go back to the landlord at the end of the month.',
      ],
      replies: [
        ['Taken one. It goes up and down, which mine has not done since the spring.'],
        ['Six left, and they go on the last Friday.'],
      ],
    },
    {
      subject: 'The blue mug',
      opener: [
        'The blue mug with the chip out of it is mine and it has gone.',
        'I am not precious about it, I would just like it back.',
        'It will be in a drawer somewhere, which is where they all end up.',
      ],
      replies: [
        ['There are nine mugs in the meeting room. One of them will be yours.'],
        ['Found it. It had been washed, which is more than I ever do to it.'],
      ],
    },
    {
      subject: 'Cycling in',
      opener: [
        'Is anybody else cycling in now the mornings are lighter?',
        'There is room for three bikes behind the back door and only mine is there.',
        'It is drier than the rack at the front.',
      ],
      replies: [
        ['I will start again next week if the weather holds.'],
        ['Two of us behind the back door now.'],
      ],
    },
  ],
  cafe: [
    {
      subject: 'Somebody left a jumper',
      opener: [
        'There is a green jumper on the back of the chair by the window.',
        'It has been there two days now.',
        'I have put it in the box under the counter.',
      ],
      replies: [
        ['Somebody came in for it this morning. Very pleased to get it back.'],
        ['Good. That box has been full since the spring.'],
      ],
    },
    {
      subject: 'Lift home after close',
      opener: [
        'Is anybody driving past the station after close tonight?',
        'I have missed the last decent bus twice this week.',
      ],
      replies: [
        ['I am going that way. Wait for me and I will drop you.'],
        ['Thank you, you are a lifesaver.'],
      ],
    },
    {
      subject: 'Cake on Saturday',
      opener: [
        'It is a birthday on Saturday and I am bringing a cake in.',
        'Say nothing to her before then.',
        'There will be plenty, so stay for a slice after your shift.',
      ],
      replies: [
        ['Not a word. I will stay.'],
        ['She had no idea. It went in about ten minutes.'],
      ],
    },
    {
      subject: 'The playlist',
      opener: [
        'We have been on the same playlist since I started and I can sing all of it.',
        'The regulars must be able to as well by now.',
        'Anybody can add to it, that is the point of it being shared.',
      ],
      replies: [
        ['I have added about twenty. Nothing anybody will object to before eleven.'],
        ['Much better. Two people asked what was on this morning.'],
      ],
    },
    {
      subject: 'The step outside is loose',
      opener: [
        'The step by the door rocks when you stand on the edge of it.',
        'Somebody will go over it with a tray one of these days.',
        'I have put a cone on it for now, which is not a repair.',
      ],
      replies: [
        ['Ring the landlord this morning rather than leaving a note about it.'],
        ['Rang. Somebody comes on Thursday and the cone stays until then.'],
      ],
    },
    {
      subject: 'Aprons are all in the wash',
      opener: [
        'Every apron is in the wash and none of them is dry.',
        'That is three days running now.',
        'We need more of them or a routine, and more of them is easier.',
      ],
      replies: [
        ['Order six more. They cost little and it saves this conversation weekly.'],
        ['Six ordered. They come Friday.'],
      ],
    },
    {
      subject: 'The radio in the kitchen',
      opener: [
        'The radio in the kitchen has stopped holding a station.',
        'It drifts off after about ten minutes and then it is just noise.',
        'It is older than I am, so I am not surprised.',
      ],
      replies: [
        ['There is a spare one in the office that nobody uses.'],
        ['Swapped over. The old one has gone in the bin, with respect.'],
      ],
    },
    {
      subject: 'Somebody is feeding the birds out front',
      opener: [
        'Somebody has been putting bread out on the front tables.',
        'The birds have worked it out and they are there before we open.',
        'It is charming right up until a customer sits down.',
      ],
      replies: [
        ['I will ask around. It is probably one of the morning regulars.'],
        ['It was, and they have stopped. The birds took a week to give up.'],
      ],
    },
  ],
  residential: [
    {
      subject: 'A parcel came for you',
      opener: [
        'A parcel came for you this afternoon and I have taken it in.',
        'It is behind the door in the hall.',
        'The driver wanted a signature, so I signed for it.',
      ],
      replies: [
        ['Thank you. I have been waiting on that all week.'],
        ['Any time.'],
      ],
    },
    {
      subject: 'Lift to the station in the morning',
      opener: [
        'I am driving to the station at about eight tomorrow.',
        'There is room if you want it, and it saves you the walk in the rain.',
      ],
      replies: [
        ['Yes please. I will be ready at eight.'],
        ['See you at the door.'],
      ],
    },
    {
      subject: 'The cat from next door',
      opener: [
        'The cat from next door has been coming in through the back window again.',
        'It sat on the table for most of the afternoon and would not be moved.',
        'I am not complaining, but somebody should tell them.',
      ],
      replies: [
        ['I told them last month and they laughed.'],
        ['Then it lives here now, I suppose.'],
      ],
    },
    {
      subject: 'Something on tonight',
      opener: [
        'There is nothing on tonight and I am not going out.',
        'I am putting something on at about eight if anybody wants to watch it.',
        'Nothing long, I have an early start.',
      ],
      replies: [
        ['I am in. I will bring the good chair down.'],
        ['Eight it is.'],
      ],
    },
    {
      subject: 'The machine finished hours ago',
      opener: [
        'The washing machine finished about three hours ago and is still full.',
        'I want to put a load on and I would rather not handle anybody laundry.',
        'No hurry, but tonight would be good.',
      ],
      replies: [
        ['Sorry, that is mine. Out now and the machine is free.'],
        ['Thank you, mine is on.'],
      ],
    },
    {
      subject: 'A car across the drive',
      opener: [
        'There is a silver car across the end of the drive and nobody can get out.',
        'It has been there since about seven this morning.',
        'If it belongs to a visitor, could they move it.',
      ],
      replies: [
        ['It is the people at number twelve. They moved it when I knocked.'],
        ['Thank you for knocking. I was working myself up to it.'],
      ],
    },
    {
      subject: 'The hall light',
      opener: [
        'The hall light has gone and the spare bulbs are the wrong fitting.',
        'It is the small screw one rather than the bayonet.',
        'I will get some tomorrow unless somebody is passing a shop today.',
      ],
      replies: [
        ['I am out this afternoon. I will pick up a packet of four.'],
        ['In and working. Three spares in the drawer.'],
      ],
    },
    {
      subject: 'Sunday afternoon',
      opener: [
        'I am cooking properly on Sunday rather than eating standing up.',
        'There is room at the table for whoever is in.',
        'About two, and nobody has to bring anything.',
      ],
      replies: [
        ['I am in. I will bring something anyway.'],
        ['Then we are four. Two it is.'],
      ],
    },
  ],
  university: [
    {
      subject: 'Coffee before the lecture',
      opener: [
        'I am going for coffee before the eleven o clock.',
        'The place in the square rather than the one downstairs.',
        'Come if you are about.',
      ],
      replies: [
        ['On my way. Order me the same as last time.'],
        ['Done, it is on the table.'],
      ],
    },
    {
      subject: 'Lost notebook',
      opener: [
        'I have lost a black notebook, probably in one of the teaching rooms.',
        'It has a term of notes in it and nothing anybody else would want.',
        'If it turns up, hold on to it and I will come and get it.',
      ],
      replies: [
        ['It is on the desk in the small room. Somebody handed it in.'],
        ['Thank you. I had almost given up on it.'],
      ],
    },
    {
      subject: 'Somewhere to work on Thursday',
      opener: [
        'Every room I have tried this week has had something in it.',
        'The quiet room is full by nine and stays full.',
        'Does anybody know of somewhere that is reliably empty on Thursdays?',
      ],
      replies: [
        ['The room at the end of the corridor is free after two. Nobody ever books it.'],
        ['It was empty and it has a window. Thank you.'],
      ],
    },
    {
      subject: 'Drinks at the end of term',
      opener: [
        'End of term drinks on the last Friday, the usual place.',
        'From about seven, and people drift in until nine.',
        'Bring whoever you like, it is not a closed thing.',
      ],
      replies: [
        ['I will be there after the last seminar.'],
        ['Good. It is the only chance most of us get to talk about anything else.'],
      ],
    },
    {
      subject: 'The printer in the corridor',
      opener: [
        'The corridor printer has been out of paper since yesterday morning.',
        'There is a box of it under the desk about two metres away.',
        'I have filled it, but I will not always be here.',
      ],
      replies: [
        ['Put a note on the lid saying where the paper is.'],
        ['Note is on. Other people have filled it twice since.'],
      ],
    },
    {
      subject: 'Reading week is earlier this year',
      opener: [
        'Reading week is a week earlier than it was last year.',
        'Half the people I have spoken to still think it is the week after.',
        'It is worth saying at the end of the next lecture.',
      ],
      replies: [
        ['I will say it twice. Once is never enough for a date.'],
        ['Said, and put on the board as well.'],
      ],
    },
    {
      subject: 'The kettle in the common room',
      opener: [
        'The kettle in the common room has been furred up for months.',
        'It takes about twice as long as it should and the water tastes of it.',
        'A bottle of the proper stuff would fix it for a year.',
      ],
      replies: [
        ['Descaled it this morning. It was worse inside than out.'],
        ['Noticeably quicker. Thank you.'],
      ],
    },
    {
      subject: 'A bike in the stairwell',
      opener: [
        'There is a bike chained to the rail in the stairwell again.',
        'It blocks half the landing and that is a fire door.',
        'The racks outside are half empty.',
      ],
      replies: [
        ['I will put a note on it before anybody cuts the lock.'],
        ['The note worked. It was gone by the afternoon.'],
      ],
    },
  ],
  public: [
    {
      subject: 'Lost property is overflowing',
      opener: [
        'The lost property box has an umbrella collection in it now.',
        'Nine umbrellas, four scarves and a single glove.',
        'Nothing has been claimed since the spring.',
      ],
      replies: [
        ['Give it until the end of the month and then take it to the charity shop.'],
        ['Taken, apart from the glove, which nobody wanted.'],
      ],
    },
    {
      subject: 'The tea rota',
      opener: [
        'The tea rota has quietly become two people doing every round.',
        'I do not mind, but it would be fairer shared out.',
        'I have put a list up rather than naming anybody.',
      ],
      replies: [
        ['Put me on it. I had not noticed, which is exactly the problem.'],
        ['Four names on it now. That is a round each a fortnight.'],
      ],
    },
    {
      subject: 'Fire drill on Wednesday',
      opener: [
        'There is a fire drill on Wednesday morning, around half past ten.',
        'We have to clear the building, visitors included.',
        'It usually takes about fifteen minutes from the alarm to being back in.',
      ],
      replies: [
        ['I will take the far end and the reading room.'],
        ['Eleven minutes, which is the best we have managed.'],
      ],
    },
    {
      subject: 'The charity tin',
      opener: [
        'The charity tin on the desk is full and has been for a while.',
        'It should go in before somebody decides to take it.',
        'I can drop it off on Saturday morning.',
      ],
      replies: [
        ['Take it Saturday and get a receipt for the file.'],
        ['Dropped off, receipt in the drawer. It was a good amount.'],
      ],
    },
    {
      subject: 'The noticeboard is out of date',
      opener: [
        'Half the noticeboard is events that happened in the spring.',
        'People stop and read it, which is the problem.',
        'I will clear it on Monday unless somebody wants anything kept.',
      ],
      replies: [
        ['Keep the one about the walking group. That is still running.'],
        ['Cleared, walking group still up, and there is room for new things.'],
      ],
    },
    {
      subject: 'The door sticks in the wet',
      opener: [
        'The front door has started sticking whenever it rains.',
        'People push it, decide we are shut and walk away.',
        'It needs planing rather than another coat of paint.',
      ],
      replies: [
        ['I will get somebody to look at it before the autumn.'],
        ['Planed and rehung. It has rained twice since and it opens fine.'],
      ],
    },
    {
      subject: 'The plants by the window',
      opener: [
        'The plants on the windowsill have had nothing all summer but sun.',
        'Two are past saving and one is doing surprisingly well.',
        'I will water them if it is agreed they are worth having.',
      ],
      replies: [
        ['They are worth having. The room is bare without them.'],
        ['Two replaced, all three watered on Mondays now.'],
      ],
    },
    {
      subject: 'A wallet was handed in',
      opener: [
        'A wallet was handed in this morning with cards in it and no name I can read.',
        'It is in the drawer and written in the book.',
        'If nobody comes for it by Friday it goes to the police station.',
      ],
      replies: [
        ['Somebody came for it at lunchtime and was very relieved.'],
        ['Written up as returned. That is the second this month.'],
      ],
    },
  ],
  iot: [
    {
      subject: 'Heating comes on too early',
      opener: [
        'The heating has been coming on at half five and the house is warm before anybody is up.',
        'It was set for the winter and nobody has changed it since.',
        'An hour later would save a fair bit and nobody would notice.',
      ],
      replies: [
        ['Put it to half six and see whether anybody complains.'],
        ['Nobody has said a word.'],
      ],
    },
    {
      subject: 'Bin night',
      opener: [
        'Bins tonight and it is the recycling this week.',
        'The lorry came at half six last time, which is earlier than it used to be.',
      ],
      replies: [
        ['Out already, both of them.'],
        ['Thank you, I would have forgotten.'],
      ],
    },
    {
      subject: 'The spare key',
      opener: [
        'The spare key is not on the hook and has not been for a few days.',
        'Somebody has it, which is fine, I just want to know who.',
        'If it is lost we should change the lock rather than pretend.',
      ],
      replies: [
        ['It is in my coat. I took it when the meter was read and forgot.'],
        ['Back on the hook then, and no harm done.'],
      ],
    },
    {
      subject: 'The garage door',
      opener: [
        'The garage door stops halfway about one time in three.',
        'It goes if you send it again, so it is not stuck on anything.',
        'It has done it since it was cold, which may be the explanation.',
      ],
      replies: [
        ['There is a sensor at the bottom of the rail that ices up. Wipe it and try again.'],
        ['Wiped it and it has been fine all week.'],
      ],
    },
    {
      subject: 'The porch light comes on at nothing',
      opener: [
        'The porch light comes on three or four times a night with nobody there.',
        'It started when the hedge grew out over the path.',
        'Either the hedge comes back or the sensitivity comes down.',
      ],
      replies: [
        ['Cut the hedge back at the weekend. It needs doing anyway.'],
        ['Cut back, and the light has been quiet for three nights.'],
      ],
    },
    {
      subject: 'Water under the sink',
      opener: [
        'There is a patch of water under the sink that was not there last week.',
        'It is small and it is not getting bigger while I watch it.',
        'I have put a tray under it rather than guessing.',
      ],
      replies: [
        ['That is usually the waste connector rather than the tap.'],
        ['It was. Tightened, and dry since.'],
      ],
    },
    {
      subject: 'The clock on the oven',
      opener: [
        'The oven clock has been an hour out since the clocks changed.',
        'Everything else in the house changed itself.',
        'I have tried holding the buttons in every order I can think of.',
      ],
      replies: [
        ['Hold the two on the right together until it beeps twice.'],
        ['That was it. Thank you, that has annoyed me for a month.'],
      ],
    },
    {
      subject: 'Windows open upstairs',
      opener: [
        'Two of the upstairs windows were open all day while it rained.',
        'Nothing is damaged, the sills took it.',
        'Worth a look round before we go out from now on.',
      ],
      replies: [
        ['That was mine and I am sorry.'],
        ['No harm done. It is an easy one to do.'],
      ],
    },
  ],
  hacker: [
    {
      subject: 'Pizza order',
      opener: [
        'Ordering pizza at about eight for whoever is still here.',
        'Two big ones covers five or six people.',
        'Tell me now rather than when it arrives.',
      ],
      replies: [
        ['One of them without olives and I am in.'],
        ['Ordered. Twenty minutes.'],
      ],
    },
    {
      subject: 'Somebody left an iron on',
      opener: [
        'The soldering iron was still on when I came in this morning.',
        'It had been on all night by the look of the tip.',
        'No harm done this time, but it is the second time this month.',
      ],
      replies: [
        ['That was me and I am sorry. I left in a hurry.'],
        [
          'It happens. I have put a note on the door at eye height rather than by the bench.',
        ],
      ],
    },
    {
      subject: 'Old machines under the bench',
      opener: [
        'There are four old machines under the bench that nobody has touched in a year.',
        'Two of them do not power up at all.',
        'I would like the space back, but I am not scrapping anything without asking.',
      ],
      replies: [
        ['Keep the one with the good case. I will take another for parts.'],
        ['The last two are gone and the bench is usable again.'],
      ],
    },
    {
      subject: 'Music in the workshop',
      opener: [
        'The speaker in the workshop is loud enough to be heard at the front door.',
        'It is fine in the evening and less fine on a Saturday afternoon.',
        'Turning it down beats losing it.',
      ],
      replies: [
        ['Agreed. I have turned the limit down rather than trusting anybody to be sensible.'],
        ['Nobody has complained since, including the neighbours.'],
      ],
    },
    {
      subject: 'The good multimeter has walked',
      opener: [
        'The good multimeter is not on the bench or in either drawer.',
        'The cheap one is where it always is, which tells you something.',
        'Nobody is in trouble, I would just like it back on the bench.',
      ],
      replies: [
        ['It is in the box under the lathe. I put it there and forgot to say.'],
        ['Back on the bench. Panic over.'],
      ],
    },
    {
      subject: 'Open evening on the last Thursday',
      opener: [
        'Open evening is the last Thursday and about eight people are coming.',
        'It works better when two of us are free to talk rather than mid project.',
        'Tell me if you can be one of the two.',
      ],
      replies: [
        ['I can. I will bring the thing I have been building to show them.'],
        ['That is exactly what makes people come back.'],
      ],
    },
    {
      subject: 'The bin by the bench',
      opener: [
        'The bin by the bench is full of offcuts and has not been emptied in weeks.',
        'Some of it is metal, which should not be in there at all.',
        'I will sort it if somebody tells me where the metal goes.',
      ],
      replies: [
        ['The metal goes in the blue crate by the door and is taken monthly.'],
        ['Sorted. The bin is half the weight it was.'],
      ],
    },
    {
      subject: 'Somebody has fixed the tap',
      opener: [
        'The tap in the workshop has stopped dripping and I did not do it.',
        'It has dripped for as long as I have been coming here.',
        'Whoever it was, thank you.',
      ],
      replies: [
        ['It needed a washer, which cost nothing and took five minutes.'],
        ['Five minutes, and a year of that noise gone.'],
      ],
    },
  ],
};

/** What arrives at a mailbox nobody in particular owns. A role mailbox is the address an
 *  organisation publishes, so what lands in it is somebody there writing to the role
 *  rather than to a person — which is why these are single messages and not threads. */
export const ROLE_MAILBOX_MAIL: Readonly<
  Record<string, readonly { readonly subject: string; readonly body: readonly string[] }[]>
> = {
  info: [
    {
      subject: 'Opening hours',
      body: [
        'Somebody asked what time we open on Saturdays.',
        'I have told them ten, which is what it says on the door.',
      ],
    },
    {
      subject: 'Enquiries through the form',
      body: [
        'Three enquiries came through the form this week and all three are answered.',
        'Two were asking the same thing, which is usually a sign the page is unclear.',
      ],
    },
  ],
  sales: [
    {
      subject: 'The quote they asked for',
      body: [
        'They want the quote broken down by week rather than as one number.',
        'I have said it will be with them on Monday.',
      ],
    },
    {
      subject: 'Renewals next month',
      body: [
        'Six renewals fall due next month and two have not answered the first letter.',
        'I will ring both rather than writing again.',
      ],
    },
  ],
  support: [
    {
      subject: 'Ticket backlog',
      body: [
        'We are down to eleven open tickets, which is the lowest it has been this year.',
        'The oldest is a fortnight old and is waiting on a part.',
      ],
    },
    {
      subject: 'Handover from this morning',
      body: [
        'Nothing outstanding from this morning.',
        'The one about the printer can wait until somebody is on that floor anyway.',
      ],
    },
  ],
  billing: [
    {
      subject: 'Unpaid from March',
      body: [
        'Two invoices from March are still unpaid and both have been chased once.',
        'I have sent a second note to each.',
      ],
    },
    {
      subject: 'The details on the template',
      body: [
        'The bank details on the invoice template are the old ones.',
        'Please use the letterhead until the template is fixed.',
      ],
    },
  ],
  postmaster: [
    {
      subject: 'The queue backed up this morning',
      body: [
        'Mail sat in the queue for about an hour this morning and then cleared on its own.',
        'It went through once the disk had been tidied up.',
      ],
    },
    {
      subject: 'Alias for the new starter',
      body: [
        'Could somebody add the new starter to the alias that goes to everybody.',
        'They have been missing the notices all week.',
      ],
    },
  ],
  office: [
    {
      subject: 'Stationery order on Friday',
      body: [
        'I am putting an order in on Friday morning.',
        'Tell me before then if you need anything or it waits a month.',
      ],
    },
    {
      subject: 'The cleaner comes Tuesday',
      body: [
        'The cleaner comes on Tuesday evening now rather than Wednesday.',
        'Please clear the desks before you leave on Tuesday.',
      ],
    },
  ],
  accounts: [
    {
      subject: 'Expenses cut off',
      body: [
        'Expenses for the quarter have to be in by the end of the month.',
        'Anything later goes into the next one, which nobody enjoys.',
      ],
    },
    {
      subject: 'Last year is filed',
      body: [
        'The paperwork for last year is boxed and in the cupboard by the window.',
        'It is in date order, so do not tip the box.',
      ],
    },
  ],
};

/** For a role mailbox nothing above names — the roster is drawn from a pool this table
 *  tracks, so it is a fallback rather than a common case. */
export const GENERIC_ROLE_MAIL: readonly {
  readonly subject: string;
  readonly body: readonly string[];
}[] = [
  {
    subject: 'Nothing outstanding',
    body: [
      'Nothing outstanding on this address today.',
      'I check it on Mondays and Thursdays.',
    ],
  },
  {
    subject: 'Passing this on',
    body: [
      'Passing this on to whoever picks the address up.',
      'It has been quiet for a fortnight.',
    ],
  },
];
