import { describe, it, expect } from 'vitest';
import { parseApache2State } from './apache2StateParser';

const aliceLine = 'apache2:port=80,user=alice,userType=user,home=/home/alice';

describe('parseApache2State — empty inputs', () => {
  it('returns empty array for undefined content', () => {
    expect(parseApache2State(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseApache2State('')).toEqual([]);
  });
});

describe('parseApache2State — valid content', () => {
  it('parses port 80 with full owner fields → http service', () => {
    expect(parseApache2State(aliceLine)).toEqual([
      {
        port: 80,
        service: 'http',
        open: true,
        owner: { username: 'alice', userType: 'user', homePath: '/home/alice' },
      },
    ]);
  });

  it('parses root running on port 80', () => {
    expect(parseApache2State('apache2:port=80,user=root,userType=root,home=/root')).toEqual([
      {
        port: 80,
        service: 'http',
        open: true,
        owner: { username: 'root', userType: 'root', homePath: '/root' },
      },
    ]);
  });

  it('parses guest running on a high port', () => {
    expect(parseApache2State('apache2:port=9000,user=anon,userType=guest,home=/home/anon')).toEqual(
      [
        {
          port: 9000,
          service: 'http',
          open: true,
          owner: { username: 'anon', userType: 'guest', homePath: '/home/anon' },
        },
      ],
    );
  });
});

describe('parseApache2State — port → service mapping', () => {
  it('maps port 443 to https', () => {
    const result = parseApache2State('apache2:port=443,user=alice,userType=user,home=/home/alice');
    expect(result[0]?.service).toBe('https');
  });

  it('maps port 8080 to http-alt', () => {
    const result = parseApache2State('apache2:port=8080,user=alice,userType=user,home=/home/alice');
    expect(result[0]?.service).toBe('http-alt');
  });

  it('maps port 80 to http', () => {
    const result = parseApache2State('apache2:port=80,user=alice,userType=user,home=/home/alice');
    expect(result[0]?.service).toBe('http');
  });

  it('maps any other port to http (e.g. 9001)', () => {
    const result = parseApache2State('apache2:port=9001,user=alice,userType=user,home=/home/alice');
    expect(result[0]?.service).toBe('http');
  });
});

describe('parseApache2State — port range', () => {
  it('accepts port 1 (lower boundary)', () => {
    const result = parseApache2State('apache2:port=1,user=root,userType=root,home=/root');
    expect(result[0]?.port).toBe(1);
  });

  it('accepts port 65535 (upper boundary)', () => {
    const result = parseApache2State('apache2:port=65535,user=root,userType=root,home=/root');
    expect(result[0]?.port).toBe(65535);
  });

  it('rejects port 0', () => {
    expect(parseApache2State('apache2:port=0,user=root,userType=root,home=/root')).toEqual([]);
  });

  it('rejects port 65536', () => {
    expect(parseApache2State('apache2:port=65536,user=root,userType=root,home=/root')).toEqual([]);
  });
});

describe('parseApache2State — malformed content', () => {
  it('returns empty for non-matching garbage', () => {
    expect(parseApache2State('garbage')).toEqual([]);
  });

  it('returns empty when port value is missing', () => {
    expect(parseApache2State('apache2:port=,user=alice,userType=user,home=/home/alice')).toEqual(
      [],
    );
  });

  it('returns empty when port is non-numeric', () => {
    expect(parseApache2State('apache2:port=abc,user=alice,userType=user,home=/home/alice')).toEqual(
      [],
    );
  });

  it('returns empty when owner fields are missing entirely', () => {
    expect(parseApache2State('apache2:port=80')).toEqual([]);
  });

  it('returns empty when user field is missing', () => {
    expect(parseApache2State('apache2:port=80,userType=user,home=/home/alice')).toEqual([]);
  });

  it('returns empty when userType field is missing', () => {
    expect(parseApache2State('apache2:port=80,user=alice,home=/home/alice')).toEqual([]);
  });

  it('returns empty when home field is missing', () => {
    expect(parseApache2State('apache2:port=80,user=alice,userType=user')).toEqual([]);
  });

  it('returns empty when userType is not root/user/guest', () => {
    expect(parseApache2State('apache2:port=80,user=alice,userType=admin,home=/home/alice')).toEqual(
      [],
    );
  });

  it('rejects content with junk prefix (regex must be anchored at start)', () => {
    expect(parseApache2State(`x${aliceLine}`)).toEqual([]);
  });

  it('rejects extra comma-separated fields after home (no trailing fields)', () => {
    expect(parseApache2State(`${aliceLine},extra=foo`)).toEqual([]);
  });

  it('rejects multi-line content (regex must be anchored at end)', () => {
    expect(parseApache2State(`${aliceLine}\nsecond line`)).toEqual([]);
  });

  it('rejects wrong daemon prefix', () => {
    expect(parseApache2State('nginx:port=80,user=alice,userType=user,home=/home/alice')).toEqual(
      [],
    );
  });
});

describe('parseApache2State — constants', () => {
  it('exports APACHE2_PID_FILE_PATH', async () => {
    const mod = await import('./apache2StateParser');
    expect(mod.APACHE2_PID_FILE_PATH).toBe('/var/run/apache2.pid');
  });

  it('exports APACHE2_PID_FILE_NAME', async () => {
    const mod = await import('./apache2StateParser');
    expect(mod.APACHE2_PID_FILE_NAME).toBe('apache2.pid');
  });
});
