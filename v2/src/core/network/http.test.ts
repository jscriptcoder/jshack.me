import { describe, expect, it } from 'vitest';
import { parseHttpUrl, resolveHref, resolveWebPath, HTTP_DEFAULT_PORT, WEB_ROOT } from './http';
import { normalize } from '../filesystem/path';

/**
 * The HTTP request shape every reader of the web surface shares — the `curl` client
 * resolving a host on the player's own LAN, and the server handler resolving a
 * cross-player fetch. The document-root confinement lives HERE rather than in the
 * filesystem walker: a web server publishes a directory, and which file a request
 * may name is a property of the protocol, not of who happens to own the file.
 */

describe('parseHttpUrl', () => {
  it('reads host, port and path from a full URL', () => {
    expect(parseHttpUrl('http://192.168.1.5:8080/status')).toEqual({
      host: '192.168.1.5',
      port: 8080,
      path: '/status',
    });
  });

  it('defaults the port and the path when the URL omits them', () => {
    expect(parseHttpUrl('http://192.168.1.5')).toEqual({
      host: '192.168.1.5',
      port: HTTP_DEFAULT_PORT,
      path: '/',
    });
  });

  it('rejects what it cannot resolve to a target rather than guessing', () => {
    // A URL that half-parses is worse than one that fails: it would send the request
    // somewhere the player did not name.
    expect(parseHttpUrl('')).toBeNull();
    expect(parseHttpUrl('not-a-url')).toBeNull();
    expect(parseHttpUrl('http://')).toBeNull();
    expect(parseHttpUrl('192.168.1.5')).toBeNull();
    expect(parseHttpUrl('ftp://192.168.1.5')).toBeNull();
    expect(parseHttpUrl('https://192.168.1.5')).toBeNull(); // no TLS story yet
  });

  it('rejects a port outside the addressable range, and accepts both ends of it', () => {
    expect(parseHttpUrl('http://192.168.1.5:0')).toBeNull();
    expect(parseHttpUrl('http://192.168.1.5:65536')).toBeNull();
    // Both boundaries are addressable — :1 and :65535 are real ports a service
    // could be hiding on, and refusing either would put them out of reach.
    expect(parseHttpUrl('http://192.168.1.5:1')?.port).toBe(1);
    expect(parseHttpUrl('http://192.168.1.5:65535')?.port).toBe(65535);
  });
});

describe('resolveWebPath', () => {
  it('names the directory index for a path that ends in a slash', () => {
    expect(resolveWebPath('/')).toBe(`${WEB_ROOT}/index.html`);
    expect(resolveWebPath('/admin/')).toBe(`${WEB_ROOT}/admin/index.html`);
  });

  it('serves the root index for a path that climbs back down to the root', () => {
    // `/assets/..` names the published directory itself, which is a directory
    // request like any other — so it serves the index rather than 404ing on a
    // directory the caller cannot read.
    expect(resolveWebPath('/assets/..')).toBe(`${WEB_ROOT}/index.html`);
    expect(resolveWebPath('/a/b/../..')).toBe(`${WEB_ROOT}/index.html`);
  });

  it('names the file a request asks for', () => {
    expect(resolveWebPath('/status')).toBe(`${WEB_ROOT}/status`);
    expect(resolveWebPath('/assets/app.js')).toBe(`${WEB_ROOT}/assets/app.js`);
  });

  it('rejects a request path that climbs out of the document root', () => {
    // Three levels up from /var/www/html is `/`, so this names /etc/passwd — a real,
    // readable file on every generated box, fetched by a caller with no session on
    // it at all. The document root is the only thing standing in the way.
    expect(resolveWebPath('/../../../etc/passwd')).toBeNull();
  });

  it('never resolves to a path outside the document root, however it is written', () => {
    const hostile = [
      '/../../../etc/passwd',
      '/../../../../../etc/passwd',
      '/./../../../etc/passwd',
      '/assets/../../../../etc/passwd',
      '/..//..//../etc/passwd',
      '/../../../root/.ssh/id_rsa',
      '/../',
      '/..',
    ];

    for (const path of hostile) {
      const resolved = resolveWebPath(path);
      // Rejecting outright is fine. What must never happen is resolving to
      // something that, once normalized, sits outside the published directory.
      if (resolved === null) continue;
      expect(normalize(resolved).startsWith(WEB_ROOT)).toBe(true);
    }
  });
});

describe('resolveHref', () => {
  it('sends a rooted href to the same host the page came from', () => {
    expect(resolveHref({ base: 'http://192.168.1.5/docs/intro.html', href: '/notes.html' })).toBe(
      'http://192.168.1.5/notes.html',
    );
  });

  it('resolves a bare href against the directory the page sits in, not the host root', () => {
    expect(resolveHref({ base: 'http://192.168.1.5/docs/intro.html', href: 'next.html' })).toBe(
      'http://192.168.1.5/docs/next.html',
    );
  });

  it('follows an absolute URL to a different host', () => {
    expect(resolveHref({ base: 'http://192.168.1.5/', href: 'http://192.168.1.9/index.html' })).toBe(
      'http://192.168.1.9/index.html',
    );
  });

  // A link is a promise the browser numbers. Anything it cannot actually fetch is
  // not one, so it never gets a number — the same rule that took the dead paths out
  // of the generated pages.
  it.each([
    ['an address, not a page', 'mailto:root@box'],
    ['a scheme nothing here serves', 'https://192.168.1.5/'],
    ['script, which this browser does not run', 'javascript:void(0)'],
    ['a place on this page rather than another page', '#section'],
    ['nothing at all', ''],
    ['nothing at all once trimmed', '   '],
  ])('refuses %s', (_reason, href) => {
    expect(resolveHref({ base: 'http://192.168.1.5/', href })).toBeNull();
  });

  it('keeps a port that is not the default, and leaves the default one unwritten', () => {
    expect(resolveHref({ base: 'http://192.168.1.5:8080/a/b.html', href: 'c.html' })).toBe(
      'http://192.168.1.5:8080/a/c.html',
    );
    expect(resolveHref({ base: 'http://192.168.1.5:80/a/b.html', href: 'c.html' })).toBe(
      'http://192.168.1.5/a/c.html',
    );
  });

  it('resolves a href that climbs before the fetch ever sees it', () => {
    expect(
      resolveHref({ base: 'http://192.168.1.5/docs/guide/intro.html', href: '../notes.html' }),
    ).toBe('http://192.168.1.5/docs/notes.html');
  });

  // The trailing slash is what tells the fetch to serve a directory's index, so
  // resolution must not tidy it away.
  it('keeps a trailing slash so a directory still names its index', () => {
    expect(resolveHref({ base: 'http://192.168.1.5/docs/intro.html', href: '/assets/' })).toBe(
      'http://192.168.1.5/assets/',
    );
  });

  it('refuses to resolve against a base that is not a page address', () => {
    expect(resolveHref({ base: 'not-a-url', href: '/notes.html' })).toBeNull();
  });

  // A scheme is what a href STARTS with. A colon further along is part of a
  // filename, and a page linking one must not have the link quietly dropped.
  it('reads a colon inside a path as part of the name, not as a scheme', () => {
    expect(resolveHref({ base: 'http://192.168.1.5/index.html', href: 'logs/aug:13.html' })).toBe(
      'http://192.168.1.5/logs/aug:13.html',
    );
  });
});
