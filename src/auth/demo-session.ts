import { cookies } from "next/headers";
import { DEMO_TOKEN_HEADER, NO_DEMO_TOKEN } from "@/lib/demo-token";

export const DEMO_COOKIE_NAME = "dojo_demo";

export interface DemoClaims {
  readonly roomId: string;
  readonly slot: number | null;
  readonly role: "watch" | "play";
  readonly sessionId: string | null;
  readonly exp: number;
}

const encoder = new TextEncoder();

function secret() {
  const key = process.env.TOKEN_ENCRYPTION_KEY ?? process.env.APP_ACCESS_PASSWORD;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  return key;
}

async function hmac(value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`demo:${secret()}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createDemoToken(
  claims: Omit<DemoClaims, "exp">,
  ttlSeconds = 60 * 60 * 8,
) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${claims.roomId}.${claims.slot ?? 0}.${claims.role}.${claims.sessionId ?? "none"}.${exp}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function readDemoToken(token?: string): Promise<DemoClaims | null> {
  if (!token) return Promise.resolve(null);
  const parts = token.split(".");
  const legacy = parts.length === 5;
  const [roomId, slotRaw, role, sessionRaw, expRaw, signature] = legacy
    ? [parts[0], parts[1], parts[2], "none", parts[3], parts[4]]
    : parts;
  if (!roomId || !slotRaw || !role || !expRaw || !signature) return Promise.resolve(null);
  if (role !== "watch" && role !== "play") return Promise.resolve(null);
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return Promise.resolve(null);
  const payload = legacy
    ? `${roomId}.${slotRaw}.${role}.${expRaw}`
    : `${roomId}.${slotRaw}.${role}.${sessionRaw}.${expRaw}`;
  const expected = await hmac(payload);
  if (expected.length !== signature.length) return Promise.resolve(null);
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  if (mismatch !== 0) return Promise.resolve(null);
  const slot = Number(slotRaw);
  return {
    roomId,
    slot: slot >= 1 && slot <= 14 ? slot : null,
    role,
    sessionId: sessionRaw && sessionRaw !== "none" ? sessionRaw : null,
    exp,
  };
}

export function demoCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 8,
  };
}

export async function getDemoClaims(request?: Request) {
  if (request?.headers.has(DEMO_TOKEN_HEADER)) {
    const token = request.headers.get(DEMO_TOKEN_HEADER);
    return readDemoToken(token && token !== NO_DEMO_TOKEN ? token : undefined);
  }
  return cookies().then((jar) => readDemoToken(jar.get(DEMO_COOKIE_NAME)?.value));
}
