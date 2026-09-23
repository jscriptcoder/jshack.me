/**
 * What each job a box's root schedules prints when it runs — and so what cron has to
 * post to root afterwards, because cron mails a job's output and stays silent about a
 * job that produced none.
 *
 * **Every job the crontab pools hold has an entry here, and a silent one is an empty
 * list.** Silence is a decision about the job rather than an omission from this table,
 * and `boxSurface.test.ts` holds the two to each other, so a job added to a pool without
 * an answer fails rather than quietly becoming silent.
 *
 * The answers are what the command really prints on a box like this one. A `find` that
 * deletes says nothing; a `find` that only matches says nothing either, because nothing
 * on these boxes is a month old or a hundred megabytes. `-qq` and `--silent` mean what
 * they say. What is left is the handful of jobs that report: sizes, a service answering
 * that it is up, and a store saying it has begun writing itself out.
 *
 * Two slots are filled per line as the mail is written: `{size}` with a size as `du -sh`
 * prints one, and `{trimmed}` with a whole number of gibibytes beside the byte count that
 * matches it exactly. Both are whole: the world keeps no fractional sizes, and `1.2G`
 * would read as a version to the sweep that keeps every generated file version-free.
 */

/** The output of every job a generated crontab can schedule, by the command itself. */
export const CRON_OUTPUT: Readonly<Record<string, readonly string[]>> = {
  // Housekeeping any box's root might schedule.
  'find /tmp -type f -mtime +7 -delete': [],
  'find /tmp -type d -empty -delete': [],
  // Nothing these boxes keep is anywhere near that big, so the match is empty.
  'find /var/log -name "*.log" -size +100M': [],
  'du -sh /var/log /home /root': ['{size}\t/var/log', '{size}\t/home', '{size}\t/root'],
  sync: [],
  'apt-get -qq update': [],
  'apt-get -qq autoclean': [],
  'journalctl --vacuum-time=2weeks': ['Vacuuming done, freed 0B of archived journals.'],
  'fstrim -av': ['/: {trimmed} trimmed'],
  updatedb: [],
  // Its whole point is to write to syslog instead of to the terminal.
  'logger -t cron heartbeat': [],
  'ntpdate -s pool.ntp.org': [],
  'find /root -name "*.swp" -delete': [],

  // Jobs that look after one service, scheduled only on a box that runs it — which is
  // why every `is-active` here answers that the service is up.
  'systemctl is-active sshd': ['active'],
  'find /var/log -name "auth.log*" -mtime +30': [],
  'find /var/www/html -name "*.tmp" -delete': [],
  'systemctl reload nginx': [],
  'du -sh /var/www/html': ['{size}\t/var/www/html'],
  'systemctl is-active vsftpd': ['active'],
  'find /var/log -name "vsftpd.log*" -mtime +30': [],
  'mysqlcheck --all-databases --auto-repair --silent': [],
  'du -sh /var/lib/mysql': ['{size}\t/var/lib/mysql'],
  'redis-cli bgsave': ['Background saving started'],
  'du -sh /var/lib/redis': ['{size}\t/var/lib/redis'],
  'systemctl is-active snmpd': ['active'],
  'systemctl is-active named': ['active'],

  // A name server's own jobs. Both are silent: the config it checks is valid, and no
  // journal file is left lying about.
  'named-checkconf /etc/bind/named.conf': [],
  'find /etc/bind -name "*.jnl" -mtime +7': [],
};
