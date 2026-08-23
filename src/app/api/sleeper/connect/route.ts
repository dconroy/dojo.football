import { NextResponse } from "next/server";
import { prisma } from "@/persistence/prisma";
import { lookupSleeperUser } from "@/adapters/sleeper/draft";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  sessionTokenFor,
} from "@/auth/current-user";
import {
  getOrCreateLeagueDraft,
  resetSharedDraft,
  saveSharedDraft,
} from "@/persistence/league-draft";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    username?: string;
    userId?: string;
    displayName?: string;
    draftId?: string;
    leagueId?: string;
  } | null;

  if (!body?.draftId) {
    const username = body?.username?.trim();
    if (!username) {
      return NextResponse.json({ error: "Sleeper username required" }, { status: 400 });
    }
    const found = await lookupSleeperUser(username);
    if (!found) {
      return NextResponse.json({ error: "Sleeper user not found" }, { status: 404 });
    }
    return NextResponse.json({
      user: {
        userId: found.userId,
        username: found.username,
        displayName: found.displayName,
      },
      leagues: found.leagues,
      drafts: found.drafts,
    });
  }

  const userId = body.userId?.trim();
  const username = body.username?.trim();
  if (!userId || !username) {
    return NextResponse.json({ error: "Sleeper user id required" }, { status: 400 });
  }

  // Never mint a session from client-echoed identifiers alone. Sleeper profiles
  // are public, but the selected draft must still belong to the looked-up user.
  const found = await lookupSleeperUser(username);
  const selectedDraft = found?.drafts.find(
    (draft) => draft.draft_id === body.draftId,
  );
  const leagueMatches =
    !body.leagueId || selectedDraft?.league_id === body.leagueId;
  if (!found || found.userId !== userId || !selectedDraft || !leagueMatches) {
    return NextResponse.json(
      { error: "That Sleeper draft does not belong to this username" },
      { status: 403 },
    );
  }

  const yahooGuid = `sleeper:${userId}`;
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const user = await prisma.user.upsert({
    where: { yahooGuid },
    create: {
      yahooGuid,
      displayName: found.displayName,
      role: "member",
      status: "active",
      encryptedAccessToken: "sleeper.none.none",
      encryptedRefreshToken: "sleeper.none.none",
      expiresAt,
      sleeperUsername: found.username,
      sleeperLeagueId: selectedDraft.league_id ?? null,
      sleeperDraftId: selectedDraft.draft_id,
    },
    update: {
      displayName: found.displayName,
      status: "active",
      sleeperUsername: found.username,
      sleeperLeagueId: selectedDraft.league_id ?? null,
      sleeperDraftId: selectedDraft.draft_id,
    },
  });

  const draftRowId = `sleeper:${selectedDraft.draft_id}`;
  const leagueKey = `sleeper.${selectedDraft.draft_id}`;
  await getOrCreateLeagueDraft(draftRowId);
  const existing = await getOrCreateLeagueDraft(draftRowId);
  if (existing.picks.length === 0 || existing.leagueKey !== leagueKey) {
    await resetSharedDraft("live", leagueKey, draftRowId);
    await saveSharedDraft({ draftId: draftRowId, mode: "live", leagueKey });
  }

  const response = NextResponse.json({
    ok: true,
    boardId: draftRowId,
    user: { id: user.id, displayName: user.displayName },
  });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    await sessionTokenFor(user),
    sessionCookieOptions(),
  );
  return response;
}
