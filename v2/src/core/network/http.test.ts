import { describe, expect, it } from 'vitest';
import { parseHttpUrl, resolveWebPath, HTTP_DEFAULT_PORT, WEB_ROOT } from './http';
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
