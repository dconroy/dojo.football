import { NextResponse } from "next/server";
import { AuthError } from "@/auth/current-user";
import {
  requireBoardAccess,
  requireBoardManager,
  requireDemoPlayer,
} from "@/auth/board-access";
import {
  ConflictError,
  applyChenImport,
  ensureBoardByes,
  ensureFreshBoardPlayers,
  getOrCreateLeagueDraft,
  replacePlayers,
  resetSharedDraft,
  saveSharedDraft,
  touchLastSeen,
} from "@/persistence/league-draft";
import { boardPayload, boardPollPayload } from "@/persistence/draft-payload";
import { isDraftPoll } from "@/lib/board-sync";
import { touchDemoSeat } from "@/persistence/demo-rooms";
import type { ChenImport } from "@/adapters/chen/boris-chen";
import type { DraftState, Player } from "@/domain";
import { replaceMockPlayersBeforeDraft } from "@/adapters/yahoo/mock-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { draftId, user, demo } = await requireBoardAccess(request);
    if (user) await touchLastSeen(user);
    if (demo?.role === "play" && demo.slot) {
      const touched = await touchDemoSeat(
        draftId,
        demo.slot,
        demo.sessionId,
      ).catch(() => false);
      if (!touched) throw new AuthError("Your demo seat expired or was reclaimed", 401);
    }
    const url = new URL(request.url);
    const since = url.searchParams.get("since");
    const playersRev = url.searchParams.get("playersRev");
    if (isDraftPoll({ since, playersRev })) {
      return NextResponse.json(
        await boardPollPayload(draftId, user, demo, { since, playersRev }),
      );
    }
    await ensureFreshBoardPlayers(draftId);
    await ensureBoardByes(draftId);
    return NextResponse.json(await boardPayload(draftId, user, demo));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to load draft" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const access = await requireBoardAccess(request);
    const { draftId, user, demo } = access;
    const body = (await request.json().catch(() => null)) as {
      action?: "reset" | "players" | "chen" | "leagueKey" | "picks";
      mode?: "mock" | "live";
      leagueKey?: string | null;
      players?: Player[];
      chen?: ChenImport;
      picks?: DraftState["picks"];
      replace?: boolean;
      importedAt?: string;
      source?: string;
      expectedUpdatedAt?: string;
    } | null;

    if (demo) {
      if (body?.action !== "picks" && body?.action !== "chen") {
        return NextResponse.json(
          { error: "That change is not available in demo rooms" },
          { status: 403 },
        );
      }
      await requireDemoPlayer(draftId, demo);
    } else if (user) {
      requireBoardManager(user);
    }

    if (body?.action === "reset") {
      await resetSharedDraft(
        body.mode === "live" ? "live" : "mock",
        body.leagueKey,
        draftId,
      );
    } else if (body?.action === "chen" && body.chen?.players?.length) {
      if (demo) {
        const current = await getOrCreateLeagueDraft(draftId);
        if (!current.leagueKey) {
          throw new ConflictError("This demo room is missing its mock draft");
        }
        const changed = await replaceMockPlayersBeforeDraft(
          current.leagueKey,
          body.chen.players.map((player) => ({
            id: player.sourceId,
            name: player.name,
            position: player.position,
            team: player.team ?? "FA",
            chenRank: player.overallRank,
            adp: player.adp,
          })),
        );
        if (!changed) {
          throw new ConflictError(
            "Rankings cannot be changed after the demo draft begins",
          );
        }
      }
      await applyChenImport(body.chen, draftId);
      await ensureBoardByes(draftId);
    } else if (body?.action === "players" && Array.isArray(body.players)) {
      await replacePlayers(
        body.players,
        body.source ?? "Imported",
        body.importedAt ?? new Date().toISOString(),
        draftId,
      );
    } else if (body?.action === "leagueKey") {
      await saveSharedDraft({
        draftId,
        leagueKey: body.leagueKey ?? null,
        expectedUpdatedAt: body.expectedUpdatedAt,
      });
    } else if (body?.action === "picks" && Array.isArray(body.picks)) {
      const current = await getOrCreateLeagueDraft(draftId);
      const replacingMock =
        body.replace === true && current.leagueKey?.startsWith("mock.");
      if (!replacingMock && body.picks.length < current.picks.length) {
        return NextResponse.json(
          { error: "Refusing to shrink the shared board" },
          { status: 409 },
        );
      }
      await saveSharedDraft({
        draftId,
        picks: body.picks,
        expectedUpdatedAt: body.expectedUpdatedAt,
      });
    } else if (body?.mode) {
      await saveSharedDraft({
        draftId,
        mode: body.mode,
        expectedUpdatedAt: body.expectedUpdatedAt,
      });
    }

    return NextResponse.json(await boardPayload(draftId, user, demo));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to update draft" }, { status: 500 });
  }
}
