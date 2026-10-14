/**
 * emailit.io's pages: where an email address comes from.
 *
 * The front page is a file in the box's document root, like every other site's, so a
 * rooted emailit.io can be defaced. Signing up is not a page: `/signup` is answered by
 * the server, so a defaced front page leaves sign-up working, and a dark box takes both
 * down.
 *
 * Plain HTML within what `lynx` renders. A command sits in a `<pre>` behind the prompt it
 * needs, `$ ` as the player and `# ` as root, as hackademy.io writes them.
 */

/** Said to the person at the keyboard, not to their character: the hashes behind these
 *  accounts are shown to other players by design, and people reuse real passwords. The
 *  Intro form says the same. */
export const REAL_PASSWORD_WARNING = "Don't use a password you use anywhere outside this game.";

export const EMAILIT_FRONT_PAGE = [
  '<html>',
  '<head><title>emailit.io</title><meta name="description" content="emailit.io: free email for everybody on the net. Sign up for an address, and read your mail with mail."></head>',
  '<body>',
  '<h1>emailit.io</h1>',
  '<p>Free email for everybody on the net. Pick a handle and a password, and',
  'handle@emailit.io is yours.</p>',
  '<h2>Sign up</h2>',
  '<p>Send us the handle you want and a password:</p>',
  '<pre>',
  '$ curl -d "handle=&lt;handle&gt;&amp;password=&lt;password&gt;" http://emailit.io/signup',
  '</pre>',
  '<p>A handle starts with a letter, then letters, numbers, hyphens or underscores, up to',
  '24 characters. A password needs at least 4 characters. First come, first served.</p>',
  `<p>${REAL_PASSWORD_WARNING}</p>`,
  '<h2>Reading your mail</h2>',
  '<p>Your mail is read with <code>mail</code>, which comes with mailutils:</p>',
  '<pre>',
  '# apt install mailutils',
  '</pre>',
  '</body>',
  '</html>',
  '',
].join('\n');
