import { describe, expect, it } from 'vitest';
import { robotsAllowFindit } from './robots';

/**
 * Whether a site lets findit list it — read the way a real crawler reads `robots.txt`,
 * so a snippet copied from the real web does here exactly what it does there.
 */

const robots = (...lines: readonly string[]): string => `${lines.join('\n')}\n`;

describe('robotsAllowFindit', () => {
  describe('a site with nothing to say is listed', () => {
    it('lists a site that serves no robots.txt at all', () => {
      expect(robotsAllowFindit(null)).toBe(true);
    });

    it('lists a site whose robots.txt is empty', () => {
      expect(robotsAllowFindit('')).toBe(true);
    });
  });

  describe('a site that shuts every crawler out', () => {
    it('is not listed', () => {
      expect(robotsAllowFindit(robots('User-agent: *', 'Disallow: /'))).toBe(false);
    });

    it('is not listed however the field names are cased or spaced', () => {
      expect(robotsAllowFindit(robots('user-AGENT:*', 'DISALLOW :   /  '))).toBe(false);
    });

    it('is not listed when its lines end the Windows way', () => {
      expect(robotsAllowFindit('User-agent: *\r\nDisallow: /\r\n')).toBe(false);
    });
  });

  describe('a site that shuts findit out by name', () => {
    it('is not listed', () => {
      expect(robotsAllowFindit(robots('User-agent: findit', 'Disallow: /'))).toBe(false);
    });

    it('is not listed however the name is cased', () => {
      expect(robotsAllowFindit(robots('User-agent: FindIt', 'Disallow: /'))).toBe(false);
    });

    it('is not listed when findit shares its group with other crawlers', () => {
      expect(
        robotsAllowFindit(robots('User-agent: Googlebot', 'User-agent: findit', 'Disallow: /')),
      ).toBe(false);
      expect(
        robotsAllowFindit(robots('User-agent: findit', 'User-agent: Googlebot', 'Disallow: /')),
      ).toBe(false);
    });
  });

  describe('rules for somebody else do not bind findit', () => {
    it('lists a site that shuts out only another crawler', () => {
      expect(robotsAllowFindit(robots('User-agent: Googlebot', 'Disallow: /'))).toBe(true);
    });

    it('lists a site that shuts out only a crawler whose name merely contains findit', () => {
      expect(robotsAllowFindit(robots('User-agent: finditbot', 'Disallow: /'))).toBe(true);
    });

    it('lists a site whose disallow comes before any crawler is named', () => {
      expect(robotsAllowFindit(robots('Disallow: /', 'User-agent: *', 'Disallow: /admin/'))).toBe(
        true,
      );
    });
  });

  describe('only the whole site counts', () => {
    it('lists a site that hides one directory', () => {
      expect(robotsAllowFindit(robots('User-agent: *', 'Disallow: /admin/'))).toBe(true);
    });

    it('lists a site that hides one page', () => {
      expect(robotsAllowFindit(robots('User-agent: *', 'Disallow: /index.html'))).toBe(true);
    });

    it('lists a site whose disallow names nothing, which allows everything', () => {
      expect(robotsAllowFindit(robots('User-agent: *', 'Disallow:'))).toBe(true);
    });

    it('lists a site whose whole-site disallow is only a comment', () => {
      expect(robotsAllowFindit(robots('User-agent: *', '# Disallow: /'))).toBe(true);
    });

    it('reads a rule with a comment after it', () => {
      expect(robotsAllowFindit(robots('User-agent: * # everyone', 'Disallow: / # go away'))).toBe(
        false,
      );
    });

    it('lets a line it cannot read end nothing, so the rules after it stay in their group', () => {
      expect(
        robotsAllowFindit(robots('User-agent: *', 'Disallow: /admin/', 'User-agent*', 'Disallow: /')),
      ).toBe(false);
    });

    it('obeys only Allow and Disallow, not a directive it does not know', () => {
      expect(robotsAllowFindit(robots('User-agent: *', 'Noindex: /'))).toBe(true);
    });

    it('ignores a line that is not a field at all', () => {
      expect(robotsAllowFindit(robots('User-agent: *', 'Disallow /', 'Crawl-delay: 10'))).toBe(
        true,
      );
    });
  });

  describe('the most specific group is the only one findit obeys', () => {
    it('lists a site that shuts everyone out but lets findit in by name', () => {
      expect(
        robotsAllowFindit(
          robots('User-agent: *', 'Disallow: /', '', 'User-agent: findit', 'Disallow:'),
        ),
      ).toBe(true);
    });

    it('does not list a site that lets everyone in but shuts findit out by name', () => {
      expect(
        robotsAllowFindit(
          robots('User-agent: findit', 'Disallow: /', '', 'User-agent: *', 'Disallow:'),
        ),
      ).toBe(false);
    });

    it('reads every group addressed to findit as one', () => {
      expect(
        robotsAllowFindit(
          robots(
            'User-agent: findit',
            'Disallow: /admin/',
            '',
            'User-agent: *',
            'Disallow:',
            '',
            'User-agent: findit',
            'Disallow: /',
          ),
        ),
      ).toBe(false);
    });

    it('keeps every earlier group when a later one names several crawlers', () => {
      expect(
        robotsAllowFindit(
          robots(
            'User-agent: *',
            'Disallow: /',
            '',
            'User-agent: findit',
            'Disallow:',
            '',
            'User-agent: Googlebot',
            'User-agent: Bingbot',
            'Disallow: /private/',
          ),
        ),
      ).toBe(true);
    });

    it('starts a new group at a crawler named after rules', () => {
      expect(
        robotsAllowFindit(robots('User-agent: *', 'Disallow: /admin/', 'User-agent: Googlebot', 'Disallow: /')),
      ).toBe(true);
    });
  });

  describe('an allow outweighs a disallow of the same reach', () => {
    it('lists a site that disallows and allows the whole site at once', () => {
      expect(robotsAllowFindit(robots('User-agent: *', 'Disallow: /', 'Allow: /'))).toBe(true);
    });

    it('does not list a site that allows only one directory', () => {
      expect(robotsAllowFindit(robots('User-agent: *', 'Disallow: /', 'Allow: /public/'))).toBe(
        false,
      );
    });
  });
});
