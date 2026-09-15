export interface StoredCookie {
  name: string; value: string; domain: string; path: string; hostOnly: boolean; secure: boolean; expires?: number;
}
