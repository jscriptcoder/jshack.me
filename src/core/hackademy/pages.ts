/**
 * hackademy.io's pages: the tutorials, written as the wiki of the people who run the site.
 *
 * Each page is plain HTML within what `lynx` renders — headings, paragraphs, lists, `<pre>`
 * and links — served as files from the box's document root, so a rooted hackademy can be
 * defaced like any other site. Every command a page shows sits in a `<pre>` behind a
 * prompt (`$ ` as the player, `# ` as root), and every example runs on the reader's own
 * box: the pages teach the tools and leave putting them together to the reader.
 */

/** A page. `description` is what a search engine says of it in a listing: only the front
 *  page is listed, so only the front page gives one. */
const page = (title: string, body: readonly string[], description?: string): string =>
  [
    '<html>',
    description === undefined
      ? `<head><title>${title}</title></head>`
      : `<head><title>${title}</title><meta name="description" content="${description}"></head>`,
    '<body>',
    ...body,
    '</body>',
    '</html>',
    '',
  ].join('\n');

const BACK = '<p><a href="/">Back to the front page</a></p>';

const FRONT_PAGE = page(
  'hackademy.io',
  [
    '<h1>hackademy.io</h1>',
    '<p>Everybody who ever got anywhere started where you are now: at a prompt, on a box,',
    'knowing nothing. These pages are what we wish somebody had handed us.</p>',
    '<p>Read them in order. Every example runs on your own box, so try each one as you go.',
    'What you do with it afterwards is your business.</p>',
    '<h2>Chapters</h2>',
    '<ol>',
    '<li><a href="/getting-around.html">Getting around</a>: files, users, and the tools your box',
    'came with</li>',
    '</ol>',
  ],
  'Tutorials for newcomers: how boxes, networks and the tools that touch them work, a chapter at a time, tried on your own box.',
);

const GETTING_AROUND = page('Getting around', [
  '<h1>Getting around</h1>',
  '<p>You have a shell. It reads what you type, runs it, and prints what comes back.',
  'Everything else on this site is built on the handful of commands below.</p>',

  '<h2>Where you are</h2>',
  '<p>Your box keeps its files in one tree that starts at <code>/</code>. Your own corner',
  'of it is your home directory, <code>/home/</code> and your name, and <code>~</code> is',
  'shorthand for it.</p>',
  '<pre>',
  '$ whoami',
  '$ pwd',
  '$ ls',
  '$ ls -a',
  '$ ls -l',
  '$ cd /var/log',
  '$ cd ~',
  '$ cat README',
  '</pre>',
  '<p><code>ls -a</code> also shows hidden files, the ones whose names start with a dot.',
  '<code>ls -l</code> shows who owns each file and who may read or change it.</p>',

  '<h2>Who you are</h2>',
  '<p>Every box has users. You are one. <code>root</code> is another, and root can read',
  'and change everything. Most boxes keep a <code>guest</code> account too, for visitors.',
  '<code>/etc/passwd</code> lists them all.</p>',
  '<pre>',
  '$ cat /etc/passwd',
  '$ su root',
  '# whoami',
  '# exit',
  '</pre>',
  '<p><code>su</code> asks for root&#39;s password: on your own box, the one you chose when',
  'you set it up. The prompt turns from <code>$</code> to <code>#</code> while you are',
  'root, and <code>exit</code> hands root back.</p>',

  '<h2>Making and changing files</h2>',
  '<pre>',
  '$ mkdir notes',
  '$ cd notes',
  '$ touch todo.txt',
  '$ nano todo.txt',
  '$ echo "buy more coffee" &gt; list.txt',
  '$ cat list.txt',
  '$ rm list.txt',
  '</pre>',
  '<p><code>nano</code> opens a file in an editor: Ctrl-O writes it out and Ctrl-X leaves.',
  '<code>&gt;</code> sends what a command prints into a file instead of to your screen,',
  'replacing whatever the file held.</p>',

  '<h2>Getting more tools</h2>',
  '<p>Your box comes with the basics. Everything else comes from the package repository,',
  'over whatever network you are on, and installing is root&#39;s job. That is how you got',
  'the browser you are reading this in.</p>',
  '<pre>',
  '# apt list',
  '# apt install nmap',
  '# apt list --installed',
  '</pre>',

  '<h2>When you are lost</h2>',
  '<pre>',
  '$ help',
  '$ man ls',
  '$ man apt',
  '</pre>',
  '<p><code>help</code> lists every command this box knows. <code>man</code> shows the',
  'manual for one of them: what it takes, and examples.</p>',

  '<h2>Practice</h2>',
  '<ol>',
  '<li>Find out who you are, then where you are, then what is in your home directory.</li>',
  '<li>Read <code>/etc/passwd</code> and count the users on your box.</li>',
  '<li>Become root, check it with <code>whoami</code>, and hand root back.</li>',
  '<li>Make a directory called <code>notes</code>, write a file in it with',
  '<code>nano</code>, and read it back with <code>cat</code>.</li>',
  '<li>Install a tool from the repository, then read its manual.</li>',
  '</ol>',
  BACK,
]);

/** Every page the site serves, by its file name under the document root. */
export const HACKADEMY_PAGES: Readonly<Record<string, string>> = {
  'index.html': FRONT_PAGE,
  'getting-around.html': GETTING_AROUND,
};
