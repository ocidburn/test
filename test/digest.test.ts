import { authorizationHeader, DigestSession, parseChallenge, requestTarget } from '../src/core/net/digest';
import { md5 } from '../src/core/net/md5';

describe('md5', () => {
  test('RFC 1321 test suite', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
    expect(md5('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')).toBe('d174ab98d277d9f5a5611c2c9f419d9f');
    expect(md5('1234567890'.repeat(8))).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  test('hashes UTF-8 bytes', () => {
    // printf 'zażółć' | md5sum
    expect(md5('zażółć')).toBe('884c73f2b5319ab2bbda84aacb14ec68');
  });
});

describe('Digest', () => {
  const rfcChallenge =
    'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"';

  test('parses a challenge', () => {
    expect(parseChallenge(rfcChallenge)).toEqual({
      realm: 'testrealm@host.com',
      nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
      opaque: '5ccc069c403ebaf9f0171e9517f40e41',
      algorithm: 'MD5',
      qopAuth: true,
    });
    expect(parseChallenge('Basic realm="x"')).toBeNull();
    expect(parseChallenge('Digest realm="x", nonce="n", algorithm=SHA-256')).toBeNull();
    expect(parseChallenge('Digest realm="x", nonce="n", qop="auth-int"')).toBeNull();
    expect(parseChallenge('Digest realm="a, b", nonce=abc')?.realm).toBe('a, b');
  });

  test('RFC 2617 example response', () => {
    const header = authorizationHeader(
      parseChallenge(rfcChallenge)!,
      { username: 'Mufasa', password: 'Circle Of Life' },
      { method: 'GET', uri: '/dir/index.html', nc: 1, cnonce: '0a4f113b' },
    );
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(header).toContain('nc=00000001');
    expect(header).toContain('qop=auth');
    expect(header).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
  });

  test('request target', () => {
    expect(requestTarget('https://h.example:8088/mobile?function=getPositions')).toBe('/mobile?function=getPositions');
    expect(requestTarget('https://h.example:8088')).toBe('/');
    expect(requestTarget('https://h.example:8088?x=1')).toBe('/?x=1');
  });

  const fakeServer = (password: string) => {
    let nonce = 1;
    const calls: (string | null)[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? null;
      calls.push(auth);
      const challenge = () =>
        new Response('', { status: 401, headers: { 'WWW-Authenticate': `Digest realm="r", qop="auth", nonce="n${nonce}"` } });
      if (!auth) return challenge();
      const nc = /nc=(\w+)/.exec(auth)![1];
      const cnonce = /cnonce="(\w+)"/.exec(auth)![1];
      const expected = authorizationHeader(
        { realm: 'r', nonce: `n${nonce}`, opaque: null, algorithm: 'MD5', qopAuth: true },
        { username: 'u', password },
        { method: 'GET', uri: '/mobile?function=x', nc: parseInt(nc, 16), cnonce },
      );
      return auth === expected ? new Response('ok', { status: 200 }) : challenge();
    };
    return { fetchImpl, calls, expire: () => (nonce += 1) };
  };

  test('answers the challenge, then signs straight away, and renews a stale nonce', async () => {
    const server = fakeServer('secret');
    const session = new DigestSession({ username: 'u', password: 'secret' });
    const url = 'https://h.example:8088/mobile?function=x';
    await expect(session.fetchText(url, { fetchImpl: server.fetchImpl })).resolves.toBe('ok');
    expect(server.calls.map((c) => c !== null)).toEqual([false, true]);
    await expect(session.fetchText(url, { fetchImpl: server.fetchImpl })).resolves.toBe('ok');
    expect(server.calls).toHaveLength(3);
    expect(server.calls[2]).toContain('nc=00000002');
    server.expire();
    await expect(session.fetchText(url, { fetchImpl: server.fetchImpl })).resolves.toBe('ok');
    expect(server.calls).toHaveLength(5);
  });

  test('a wrong password is reported, not retried forever', async () => {
    const server = fakeServer('secret');
    const session = new DigestSession({ username: 'u', password: 'wrong' });
    await expect(session.fetchText('https://h.example:8088/mobile?function=x', { fetchImpl: server.fetchImpl })).rejects.toThrow(
      'login or password rejected',
    );
    expect(server.calls).toHaveLength(2);
  });
});
