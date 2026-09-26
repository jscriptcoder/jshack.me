/**
 * Whether a site lets findit list it — its `robots.txt` read the way a real crawler
 * reads one, so a snippet copied off the real web does here what it does there.
 *
 * Being listed is automatic: every page on a public `:80` is found unless its owner
 * says otherwise. That is only fair because saying otherwise is easy, and it is said in
 * the web's own words. The rules are the standard ones, cut down to the single question
 * findit asks — may it read `/`?
 *
 *   - Rules come in GROUPS, each opened by one or more `User-agent` lines. A crawler obeys
 *     the group that names it, and only when no group does, the group for `*`. So a site
 *     can shut everybody out and still let findit in by name, or the other way round.
 *   - Every group naming the same crawler is read as one.
 *   - Only a rule for the whole site stops findit: `Disallow: /admin/` hides a directory
 *     findit never reads, and an empty `Disallow:` allows everything.
 *   - An `Allow` outweighs a `Disallow` of the same reach.
 */

/** The name findit answers to in a `User-agent` line. */
const CRAWLER_NAME = 'findit';
const ANY_CRAWLER = '*';
/** The one path findit reads on a site: its front page. */
const FRONT_PAGE = '/';

type Rule = { readonly allow: boolean; readonly path: string };
type Group = { readonly agents: readonly string[]; readonly rules: readonly Rule[] };
type Field = { readonly name: string; readonly value: string };

/** A line as `name: value`, with any comment cut off — or null for a line that says
 *  nothing, or says it in no form a crawler understands. */
const fieldOf = (line: string): Field | null => {
  const commentAt = line.indexOf('#');
  const content = commentAt === -1 ? line : line.slice(0, commentAt);
  const colonAt = content.indexOf(':');
  if (colonAt === -1) return null;
  return {
    name: content.slice(0, colonAt).trim().toLowerCase(),
    value: content.slice(colonAt + 1).trim(),
  };
};

/** The file's groups, in order. A `User-agent` line straight after another joins its
 *  group; one after a rule opens the next. Rules before any crawler is named belong to
 *  nobody and are dropped. */
const groupsOf = (robotsTxt: string): readonly Group[] =>
  robotsTxt.split(/\r?\n/).reduce<readonly Group[]>((groups, line) => {
    const field = fieldOf(line);
    if (field === null) return groups;
    const current = groups.at(-1);
    if (field.name === 'user-agent') {
      const agent = field.value.toLowerCase();
      if (current !== undefined && current.rules.length === 0) {
        return [...groups.slice(0, -1), { ...current, agents: [...current.agents, agent] }];
      }
      return [...groups, { agents: [agent], rules: [] }];
    }
    if (current === undefined) return groups;
    if (field.name !== 'allow' && field.name !== 'disallow') return groups;
    const rule = { allow: field.name === 'allow', path: field.value };
    return [...groups.slice(0, -1), { ...current, rules: [...current.rules, rule] }];
  }, []);

/** The rules findit obeys: every group naming it, or failing that every group for any
 *  crawler, or none at all. */
const rulesForFindit = (groups: readonly Group[]): readonly Rule[] => {
  const addressedTo = (agent: string) =>
    groups.filter((group) => group.agents.includes(agent)).flatMap((group) => group.rules);
  const byName = addressedTo(CRAWLER_NAME);
  return byName.length > 0 ? byName : addressedTo(ANY_CRAWLER);
};

/**
 * True when findit may list the site whose `robots.txt` this is. A site that serves none
 * has said nothing, and is listed.
 */
export const robotsAllowFindit = (robotsTxt: string | null): boolean => {
  if (robotsTxt === null) return true;
  const rules = rulesForFindit(groupsOf(robotsTxt));
  const reachesFrontPage = (allow: boolean) =>
    rules.some((rule) => rule.allow === allow && rule.path === FRONT_PAGE);
  return !reachesFrontPage(false) || reachesFrontPage(true);
};
