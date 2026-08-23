import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, readSessionToken } from "@/auth/session";

const PUBLIC_EXACT = new Set([
  "/",
  "/dojo-mark.png",
  "/login",
  "/demo",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/api/auth/login",
  "/api/auth/gate",
  "/api/auth/logout",
  "/api/auth/dev-login",
  "/api/yahoo/callback",
  "/api/sleeper/connect",
  "/api/demo",
  "/api/demo/join",
  "/api/draft",
  "/api/draft/pick",
  "/api/draft/story",
  "/api/players/brief",
  "/api/yahoo/mock",
  "/api/yahoo/sync",
  "/api/chen",
  "/api/rankings",
]);

function isPublic(pathname: string) {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/media/")) return true;
  if (pathname.startsWith("/landing/")) return true;
  if (pathname.startsWith("/api/demo/")) return true;
  if (pathname.startsWith("/docs/screenshots/")) return true;
  if (/\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/i.test(pathname)) return true;
  return false;
}

function loginRedirect(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (pathname === "/api/yahoo/auth") return NextResponse.next();

  const claims = await readSessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!claims) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    return loginRedirect(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest).*)",
  ],
};
