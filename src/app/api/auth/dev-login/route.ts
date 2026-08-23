import { NextResponse } from "next/server";
import { prisma } from "@/persistence/prisma";
import { ACCESS_COOKIE_NAME, createAccessToken } from "@/auth/access";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  sessionTokenFor,
} from "@/auth/current-user";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const e2eSecret = process.env.E2E_LOGIN_SECRET?.trim();
  const developmentSecret = process.env.APP_ACCESS_PASSWORD?.trim();
  const expected =
    e2eSecret ||
    (process.env.NODE_ENV !== "production" ? developmentSecret : undefined);
  if (!expected) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { secret?: string } | null;
  if (!body?.secret || body.secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.upsert({
    where: { yahooGuid: "e2e-admin" },
    create: {
      yahooGuid: "e2e-admin",
      displayName: "E2E Admin",
      role: "admin",
      status: "active",
      encryptedAccessToken: "e2e",
      encryptedRefreshToken: "e2e",
      expiresAt: new Date(Date.now() + 86_400_000),
      draftSlot: 6,
      teamName: "Cobra Kai",
    },
    update: {
      role: "admin",
      status: "active",
      draftSlot: 6,
    },
  });

  const response = NextResponse.json({ ok: true, userId: user.id });
  if (process.env.APP_ACCESS_PASSWORD) {
    response.cookies.set(
      ACCESS_COOKIE_NAME,
      await createAccessToken(process.env.APP_ACCESS_PASSWORD),
      sessionCookieOptions(),
    );
  }
  response.cookies.set(
    SESSION_COOKIE_NAME,
    await sessionTokenFor(user),
    sessionCookieOptions(),
  );
  return response;
}
