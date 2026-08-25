import { DEMO_TOKEN_HEADER, NO_DEMO_TOKEN } from "./demo-token";

const DEMO_TOKEN_STORAGE_KEY = "dojo-demo-tab-token";

export function readDemoTabToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(DEMO_TOKEN_STORAGE_KEY);
}

export function saveDemoTabToken(token: unknown): void {
  if (typeof window === "undefined" || typeof token !== "string" || !token) return;
  window.sessionStorage.setItem(DEMO_TOKEN_STORAGE_KEY, token);
}

/**
 * Authenticates demo requests with this tab's token. Sending an explicit
 * sentinel when the tab has no token prevents another tab's fallback cookie
 * from being mistaken for this tab's session.
 */
export function demoFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(DEMO_TOKEN_HEADER, readDemoTabToken() ?? NO_DEMO_TOKEN);
  return fetch(input, { ...init, headers });
}
