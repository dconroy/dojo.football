import { NextResponse } from "next/server";
import { AuthError } from "@/auth/current-user";
import {
  requireBoardAccess,
  requireBoardManager,
  requireDemoPlayer,
} from "@/auth/board-access";
import {
  appendSharedPick,
  draftStateFor,
  getOrCreateLeagueDraft,
  savePicks,
  undoSharedPick,
  userPrefs,
} from "@/persistence/league-draft";
import { boardPayload } from "@/persistence/draft-payload";
import { demoRoomStarted } from "@/persistence/demo-rooms";
import { opponentPick, selectionForOverall, simulateToUserTurn } from "@/domain";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { draftId, user, demo } = await requireBoardAccess(request);
    const body = (await request.json().catch(() => null)) as {
      playerId?: string;
      action?: "pick" | "undo" | "advance" | "simulate";
    } | null;

    if (demo && body?.action) {
      return NextResponse.json(
        { error: "Spectators and demo players cannot control the room" },
        { status: 403 },
      );
    }

    if (!demo && body?.action && user) {
      requireBoardManager(user);
    }

    if (body?.action === "undo") {
      await undoSharedPick(draftId);
      return NextResponse.json(await boardPayload(draftId, user, demo));
    }

    if (body?.action === "advance" || body?.action === "simulate") {
      if (demo) {
        return NextResponse.json({ error: "Demo rooms are timer-driven" }, { status: 403 });
      }
      const shared = await getOrCreateLeagueDraft(draftId);
      if (!user) throw new AuthError("Authentication required", 401);
      const prefs = userPrefs(user);
      const current = draftStateFor(shared, prefs.draftSlot);
      const next =
        body.action === "simulate"
          ? simulateToUserTurn(current, shared.players)
          : opponentPick(current, shared.players);
      if (next.picks.length <= shared.picks.length) {
        return NextResponse.json({ error: "No opponent pick available" }, { status: 409 });
      }
      await savePicks(next.picks, draftId);
      return NextResponse.json(await boardPayload(draftId, user, demo));
    }

    if (!body?.playerId) {
      return NextResponse.json({ error: "playerId required" }, { status: 400 });
    }
    if (demo) {
      const player = await requireDemoPlayer(draftId, demo);
      if (!(await demoRoomStarted(draftId))) {
        throw new AuthError("This demo draft has not started", 403);
      }
      const shared = await getOrCreateLeagueDraft(draftId);
      const alreadySynchronized = shared.picks.some(
        (pick) => pick.player.id === body.playerId,
      );
      if (!alreadySynchronized) {
        const current = selectionForOverall(
          shared.picks.length + 1,
          shared.teamCount,
        );
        if (current.slot !== player.slot) {
          throw new AuthError("It is not your demo seat's turn", 403);
        }
      }
    } else if (user) {
      const shared = await getOrCreateLeagueDraft(draftId);
      const current = selectionForOverall(
        shared.picks.length + 1,
        shared.teamCount,
      );
      const slot = userPrefs(user).draftSlot;
      if (current.slot !== slot) {
        throw new AuthError(`Pick ${current.overall} belongs to draft slot ${current.slot}`, 403);
      }
    }
    await appendSharedPick(body.playerId, { draftId });
    return NextResponse.json(await boardPayload(draftId, user, demo));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to record pick" },
      { status: 400 },
    );
  }
}
