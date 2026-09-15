import { expect, it } from "vitest";
import { basicAuthorization, CookieJar } from "./auth.js";

it("encodes Basic credentials and rejects ambiguous usernames", () => {
  expect(basicAuthorization('user', 'p:a')).toBe('Basic ' + Buffer.from('user:p:a').toString('base64'));
  expect(() => basicAuthorization('user:name', 'pass')).toThrow('colon');
});
it("tracks cookie scope, expiry, replacement, and deletion", () => {
  const jar = new CookieJar(); const url = new URL('https://api.test/account/login');
  const headers = new Headers();
  headers.append('set-cookie', 'session=one; Path=/account; Secure; HttpOnly; Max-Age=60');
  headers.append('set-cookie', 'foreign=bad; Domain=other.test; Path=/');
  jar.receive(url, headers, 1000);
  expect(jar.header(new URL('https://api.test/account/list'), 2000)).toBe('session=one');
  expect(jar.header(new URL('https://api.test/accounts'), 2000)).toBe('');
  expect(jar.header(new URL('http://api.test/account/list'), 2000)).toBe('');
  expect(jar.header(new URL('https://other.test/account/list'), 2000)).toBe('');
  expect(jar.header(url, 62000)).toBe('');
  jar.receive(url, new Headers({ 'set-cookie': 'session=two; Path=/account; Secure' }), 2000);
  expect(jar.header(url, 3000)).toBe('session=two');
  jar.receive(url, new Headers({ 'set-cookie': 'session=gone; Path=/account; Max-Age=0' }), 3000);
  expect(jar.snapshot(3000)).toEqual([]);
});
