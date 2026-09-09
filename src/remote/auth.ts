/** Basic authentication and a small RFC-style cookie jar for server-side clients. */
export function basicAuthorization(username: string, password: string): string {
  if (username.includes(":")) throw new Error("Basic authentication usernames cannot contain a colon");
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}
export interface StoredCookie {
  name: string; value: string; domain: string; path: string; hostOnly: boolean; secure: boolean; expires?: number;
}
export class CookieJar {
  private cookies: StoredCookie[];
  constructor(cookies: readonly StoredCookie[] = []) { this.cookies = cookies.map((cookie) => ({ ...cookie })); }
  receive(url: URL, response: Headers, now = Date.now()): void {
    for (const line of response.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const at = pair!.indexOf("="); if (at < 1) continue;
      const name = pair!.slice(0, at).trim(); const value = pair!.slice(at + 1).trim();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) || /[\r\n;]/u.test(value)) continue;
      const attrs = Object.fromEntries(attributes.map((part) => {
        const equals = part.indexOf("="); return equals < 0 ? [part.trim().toLowerCase(), ""] : [part.slice(0, equals).trim().toLowerCase(), part.slice(equals + 1).trim()];
      }));
      const domain = (attrs["domain"] ?? url.hostname).replace(/^\./u, "").toLowerCase();
      // A jar belongs to an endpoint; accepting only that host also rejects public-suffix cookies.
      if (domain !== url.hostname.toLowerCase()) continue;
      const path = attrs["path"]?.startsWith("/") ? attrs["path"] : url.pathname.slice(0, url.pathname.lastIndexOf("/")) || "/";
      const secure = Object.hasOwn(attrs, "secure");
      if (secure && url.protocol !== "https:") continue;
      if (name.startsWith("__Secure-") && !secure) continue;
      if (name.startsWith("__Host-") && (!secure || path !== "/" || Object.hasOwn(attrs, "domain"))) continue;
      let expires = attrs["expires"] === undefined ? undefined : Date.parse(attrs["expires"]);
      if (attrs["max-age"] !== undefined && /^-?\d+$/u.test(attrs["max-age"])) expires = now + Number(attrs["max-age"]) * 1000;
      this.cookies = this.cookies.filter((cookie) => !(cookie.name === name && cookie.domain === domain && cookie.path === path));
      if (expires !== undefined && expires <= now) continue;
      this.cookies.push({ name, value, domain, path, secure, hostOnly: !Object.hasOwn(attrs, "domain"),
        ...(expires === undefined || Number.isNaN(expires) ? {} : { expires }) });
    }
  }
  header(url: URL, now = Date.now()): string {
    return this.cookies.filter((cookie) => cookie.domain === url.hostname.toLowerCase()
      && (!cookie.secure || url.protocol === "https:") && (cookie.expires === undefined || cookie.expires > now)
      && (url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith("/") ? cookie.path : cookie.path + "/")))
      .sort((a, b) => b.path.length - a.path.length).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }
  snapshot(now = Date.now()): StoredCookie[] { return this.cookies.filter((cookie) => cookie.expires === undefined || cookie.expires > now).map((cookie) => ({ ...cookie })); }
}
