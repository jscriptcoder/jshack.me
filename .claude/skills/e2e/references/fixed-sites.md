# Fixed sites

**Publishing a site to browse (Act 9's setup)**: `apt install lynx` and `apt install nginx` —
neither is preinstalled — then `nginx` to listen, and **`rm /var/www/html/index.html` before
writing your own**, because installing nginx leaves a default page there and a half-generated
site makes the link count meaningless.

**Putting a player's page on findit** (verified v0.271.0, A on `CASA-DE-RAMIREZ`, B on
`ESPRESSO-EXPRESS`). A publishes as above, then `ssh root@<subnet>.1` (password per [reaching-a-state.md](reaching-a-state.md#shell-on-the-ap-gateway)) and
`echo "forward 80 to <A's LAN IP>:80" > /etc/iptables/rules.v4`. Nothing else: B's
`curl "findit.io/?q=<a word on A's page>"` lists it at once, by title and A's bare public IP.
- **A's public IP is shown nowhere in the game.** The world derives it:
  `npx tsx -e "import { publicAddressOf } from './scripts/publicAddressOf.ts'; console.log(publicAddressOf('<ESSID>'))"`.
- **Pick a network with no site of its own.** On a publisher's network (every corporate, café
  and institutional one — including the three government ones, `RIDGEMONT-PD` `ridgemontpd.gov`,
  `CITY-HALL-WIFI` `ridgemont.gov` and `COURTHOUSE-GUEST` `ridgemontcourts.gov`, since v0.273.0, and
  the four shops, `KWIK-E-MART` `kwikemart.com`, `MONSTROMART` `monstromart.com`, `BUY-N-LARGE`
  `buynlarge.com` and `MEGA-LO-MART` `megalomart.com`, since v0.276.0) the page is listed under the institution's DOMAIN, not an IP. The residential, iot and hacker
  entries are the ones that show a bare address.
- **`echo … > file` writes ONE line; `echo … >> file` adds one more** (since v0.277.0). `echo`
  takes no `-e`, so a two-line `robots.txt` is `echo "User-agent: *" > robots.txt` then
  `echo "Disallow: /" >> robots.txt` — no `nano` needed. `>>` puts its output on a new line
  even though no file here ends in a newline.
- **The crawl writes nothing on A's box.** Only real visits (B's `lynx` follow, a direct `curl`)
  land in A's `/var/log/access.log`; a search never does. Check the row, not the screen.

**Rooting any fixed site (emailit.io, findit.io, mapit.io, hackademy.io, chainit.io) is
CVE-only, by design.** A fixed site's root password is drawn from the UNCRACKABLE pool —
`fixedSiteFs.ts` sets `CRACKABLE_ROOT_CHANCE = 0` with the comment "the way in is the software
it runs … never a guess" — so [offline-secrets.md](offline-secrets.md) cannot recover it and `ssh root@<domain>` with a guessed
password never lands. The ONLY in-game root is a **root-tier** CVE on `:80`/`:22`, and an
exploit session's `userType` is the CVE's tier, not the account it lands on
(`sessions/exploitCreateSession.ts`): a fixed site holds only `root`, so a user/guest-tier hole
gives you a shell *as the root account at user/guest tier*, which is not a root session (a
root-only file like `/etc/emailit/passwd` stays hidden). So when the day's holes are only
user/guest tier, the box simply cannot be rooted that day — prove any root-only behaviour with
the feature's wire-check seeded session instead (e.g. `testMailSpool.ts`,
`testHiremeBoardRoot.ts` for the boards' server's `/etc/hireme/boards`), and say in the
evidence that the UI run stood the root session up directly. **Trap:** matching a fixed site's
`/etc/passwd` root hash with `plaintextFor` WILL "find" it, because the helper searches the
uncrackable pool too — it is NOT a route a player has, and must never be presented
as an in-game crack. (The crackable hashes decision 3 means are the player-chosen *account*
hashes in `/etc/emailit/passwd`, recovered with a real external wordlist tool once you are
already root — not root's own password.)

**Rooting findit, reading the prize, and restoring it** (slice 4). findit's root does not crack
([offline-secrets.md](offline-secrets.md) won't help), so the only way in is a live CVE on its `:80` or `:22` — `nmap -sV findit.io`
names it. **Rooting it to DEFACE the front page needs a ROOT-tier full-shell hole, and that window
is on the world's clock** (nginx's is ~day 106); on an earlier day findit's live holes are user- or
guest-tier, which is enough to READ but not to write its root-owned `/var/www/html/index.html`.
- **Reading the prize needs any shell.** `msfconsole findit.io 80` (staging findit's manifest onto a
  shell-granting nginx via psql, as §"a version is visible" stages one) stands you on findit as
  root-the-account at the granted tier; `cat /var/log/access.log` then shows every searcher's
  `GET /?q=<term>` under the address the server holds for them — intel on who is hunting what.
- **Reading a rooted findit works because the exploit session records findit's OWN network**, not
  the WiFi the attack came from — without that the box resolves to nothing and the shell reads an
  empty tree. Fixed in this slice; the guard is `scripts/testRestoreSite.ts findit.io`.
- **`scripts/restoreSite.ts findit.io` is the undo, and it is a reboot.** `npx dotenv -e
  .env.development.local -- npx tsx scripts/restoreSite.ts findit.io` closes every session on
  findit, empties its journal (defacement, planted manifest, logs, all of it) and leaves a fresh
  boot marker. Run it twice and nothing breaks; run it with no `SUPABASE_*` env and it exits 2
  rather than touching anything.
- **After the restore the standing shell has LOST the box.** Its session is closed server-side, so a
  write is refused (`no_session`) and the next `cat` reads nothing of findit — the box is
  unresolvable to it, so the shell silently falls back to the attacker's OWN tree (`cat: command not
  found`, since the fallback tree is not what the prompt claims). Whether they also get a clean
  on-screen eviction is the pre-existing FIRST-REBOOT boot-id nuance (`core/boot/bootId.ts`): a shell
  that hopped on while findit had NO marker captured no boot-id to compare, so the marker the restore
  writes cannot notify it — findit's SECOND restore onward evicts cleanly. The enforcement (closed
  session, refused write) does not depend on it.

**Showing a fixed site defaced and restored, before any root window is open** (verified
2026-10-14, v0.379.0, on mapit.io). Plant the defaced page the way `scripts/testRestoreSite.ts`
does: a temp file inside the repo upserting one `patches` row with the service-role client,
`machine_id` = `computeApGatewayId('<domain>')`, `path` `/var/www/html/index.html`, `owner`
`root`, `permissions` `WEB_PAGE_FILE`, `node_type` `file`, any `writer_key`, `is_new` false,
`onConflict` `machine_id,path,writer_key`. `lynx <domain>` serves it to the player at once;
`scripts/restoreSite.ts <domain>` deletes it with every other row on the box, and the next
`lynx` shows the generated page.

- **findit's front page opens typing in its search field.** To reach the link under the form,
  `Escape` out of the field, then `ArrowDown` twice (the button, then `[1]mapit.io`). The
  selected link is the element with `aria-current="true"`; read its `textContent` before
  pressing `Enter`.

**Reading who looked up what on chainit.io** (verified 2026-10-16, v0.394.0, game day 96). A
player needs `apt install wallet` before `wallet init` (it is not preinstalled), and coins only
enter the ledger by mint: `scripts/mintCoins.ts <address> <amount>`, or `wallet_mint` through the
service role. `lynx chainit.io` opens typing in the lookup field, so type the address one `press`
per character ([driving-the-terminal.md](driving-the-terminal.md)), `Enter` submits it, and the address page's links are reached with `Escape`
then `ArrowDown`. To read the log, a shell on chainit is enough; no root tier is needed.
- **On day 96 no release of chainit's nginx or sshd has a root-tier hole, and its own nginx
  (1.26.0) only runs a script.** Compute the day's outcomes with `exploitOutcome(key, version,
  gameDayAt(now))` over `packageTimeline(key, day)`, then stage a shell-granting version as
  findit's close-out did: one service-role `patches` row on `computeApGatewayId('chainit.io')`
  at `/var/lib/dpkg/status`, the generated file (`readDpkgStatus`) with nginx's `Version:` swapped
  (1.28.3 gave a user-tier full shell that day), owner `root`, the file's own perms, `node_type`
  `file`. `msfconsole chainit.io 80` then lands, and `cat /var/log/access.log` shows every
  `/address?a=…`, `/recent` and `/rich` under the visitor's network address.
- **`Escape` outside a field QUITS lynx.** `←` goes back one page and leaves you outside the
  field, so a second `Escape` there drops you at the prompt and the `ArrowDown`s and `Enter` that
  follow land in the shell. Read the footer first: `Esc Leave field` means you are in the field,
  `← Back q Quit` means you are not.
- `scripts/restoreSite.ts chainit.io` clears the staged manifest and the log with everything else.

**Reaching hireme.io's boards' server** (verified 2026-10-21, v0.422.0, game day 101). It has no
domain and no address of its own: it answers at every board's address, and a board's address
is only in its owner's mail (`mail read <n>` after applying) or in `hireme_boards`. Aim every
command at that `194.` address.
- **Applying from lynx**: `lynx hireme.io` opens typing in the Email field; type the bare handle
  one `press` per character and `Enter` submits. The page never shows the address.
- **A shell there** is staged the way chainit's is: one service-role `patches` row on
  `computeApGatewayId('boards.hireme.io')` at `/var/lib/dpkg/status` with nginx's `Version:`
  swapped (1.28.3 gave a user-tier full shell on day 101), then `msfconsole <board address> 80`.
  `cat /etc/hostname` reads `boards`; the prompt says `root@ap-gw`, as on every fixed site.
- **At user tier `/etc/hireme` is hidden**, so `cat /etc/hireme/boards` answers "No such file or
  directory". The root view needs a root-tier hole; on a day without one it rests on
  `testHiremeBoardRoot.ts`. `access.log` is readable at any tier and names each board read as
  `"GET http://<address>/ HTTP/1.1"` beside the reader's address.
- `scripts/restoreSite.ts boards.hireme.io` restores it; the standing shell's next command prints
  "Connection to ap-gw closed by remote host." Boards and `hireme_boards` are untouched.

**Reading valleynews.io while the operator posts** (verified 2026-10-21, v0.424.0). Stories
reach the paper only through `scripts/valleynews.ts post <file>`, `edit <id> <file>` and
`remove <id>`, run from the repo with `npx dotenv -e .env.development.local -- npx tsx …`; write
the story files in the scratchpad. Each prints the id to open, and a page reads the table on
every visit, so a lynx reload shows a change at once.
- **Wait on lynx's address line, never on page text.** The scrollback still holds everything an
  earlier `curl` printed, findit's results included, so a wait for "Harrow Valley paper" matched
  the old search and the screenshot caught lynx still loading. Poll `innerText` for
  `http://valleynews.io/<path>\n`, the bar lynx draws once the page is up.
- **A story that is not there never opens lynx**: `lynx valleynews.io/story?id=53` after a
  removal answers `lynx: (22) The requested URL returned error: 404` at the prompt.
- **A story's links**: the nav is `[1]`–`[3]`, the section heading on a story page `[4]`, and a
  section's stories follow from `[4]`. A `Source: …https://…` line carries no number: it is text.
- **The defaced masthead** is planted as for mapit (`computeApGatewayId(fixedSite(
  VALLEYNEWS_NETWORK).key)` at `/var/www/html/index.html`); the views keep answering from the
  table, and `restoreSite.ts valleynews.io` brings the masthead back with every story kept.
- **Clean up** by `remove`-ing each story the run posted: the paper opens empty, and
  `testValleynews.ts` refuses a paper that holds stories.
