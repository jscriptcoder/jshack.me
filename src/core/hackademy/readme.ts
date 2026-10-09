/**
 * The README a new player finds in their home directory: the one thing the game plants
 * there. A fresh box is on no network, so it walks them online, then to a browser, then to
 * hackademy.io, where everything else is taught. It names each step and explains none of
 * them; the explaining is the site's job.
 */
export const WELCOME_README = [
  'Welcome to your box. Everything happens at the prompt: "help" lists every',
  'command, and "man <command>" explains one.',
  '',
  "Your box isn't on any network yet. Find one in range and crack its key",
  '(airodump-ng shows each BSSID and ESSID, and aircrack-ng finds the PASSWORD):',
  '$ airmon-ng start wlan0',
  '$ airodump-ng',
  '$ aircrack-ng BSSID',
  '$ airmon-ng stop wlan0',
  '$ nmcli connect ESSID PASSWORD',
  '',
  'Then get a browser and read on. Installing is root\'s job, and su asks for',
  'the root password you chose when you set this box up.',
  '$ su root',
  '# apt install lynx',
  '# lynx http://hackademy.io',
  '',
].join('\n');
