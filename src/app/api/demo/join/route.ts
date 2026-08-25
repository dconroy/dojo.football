import { NextResponse, type NextRequest } from "next/server";
import {
  DEMO_COOKIE_NAME,
  createDemoToken,
  demoCookieOptions,
  getDemoClaims,
} from "@/auth/demo-session";
import { prisma } from "@/persistence/prisma";
import { draftStateFor, getOrCreateLeagueDraft } from "@/persistence/league-draft";
import {
  claimDemoSeat,
  demoClientState,
  demoSeatMembers,
  findOrCreateOpenDemoRoom,
  releaseDemoSeat,
  takenSeatsFor,
  validateDemoTeamName,
} from "@/persistence/demo-rooms";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";

export const runtime = "nodejs";

function parseSlot(value: unknown): number | null {
  if (value == null) return null;
  const slot = Number(value);
  return Number.isInteger(slot) && slot > 0 ? slot : null;
}

async function roomIsReal(roomId: string): Promise<boolean> {
  const room = await prisma.leagueDraft.findUnique({
    where: { id: roomId },
    select: { leagueKey: true },
  });
  return Boolean(room?.leagueKey);
}

export async function POST(request: NextRequest) {
  let requestedSlot: number | null = null;
  let requestedRoom: string | null = null;
  let displayName = "";
  let requestedDisplayName: unknown;
  try {
    const body = (await request.json().catch(() => null)) as {
      slot?: unknown;
      roomId?: unknown;
      displayName?: unknown;
    } | null;
    requestedSlot = parseSlot(body?.slot);
    requestedRoom =
      typeof body?.roomId === "string" && body.roomId.trim() ? body.roomId.trim() : null;
    requestedDisplayName = body?.displayName;
  } catch {
    requestedSlot = null;
  }

  try {
    displayName = validateDemoTeamName(requestedDisplayName);
    const existing = await getDemoClaims(request);
    // Prefer an explicitly requested room, then the cookie's room. Either way,
    // only reuse a room that still exists as a real (mock-config) room.
    let roomId = requestedRoom ?? existing?.roomId;
    if (roomId && !(await roomIsReal(roomId))) roomId = undefined;
    if (!roomId) {
      roomId = (await findOrCreateOpenDemoRoom()).shared.id;
    }
    if (existing?.role === "play") {
      await releaseDemoSeat(
        existing.roomId,
        existing.slot,
        existing.sessionId,
      );
    }
    let claimed;
    try {
      claimed = await claimDemoSeat(roomId, displayName, requestedSlot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // The room filled up while they were deciding: move them to a fresh room.
      // A specific-seat collision should surface so they can pick again.
      if (/full/i.test(message)) {
        roomId = (await findOrCreateOpenDemoRoom()).shared.id;
        claimed = await claimDemoSeat(roomId, displayName, requestedSlot);
      } else if (/taken/i.test(message)) {
        return NextResponse.json(
          { error: message, takenSlots: await takenSeatsFor(roomId) },
          { status: 409 },
        );
      } else {
        throw error;
      }
    }
    const shared = await getOrCreateLeagueDraft(claimed.shared.id);
    const token = await createDemoToken({
      roomId: shared.id,
      slot: claimed.slot,
      role: "play",
      sessionId: claimed.sessionId,
    });
    const response = NextResponse.json({
      ...shared,
      draft: draftStateFor(shared, claimed.slot),
      members: await demoSeatMembers(shared.id),
      me: {
        id: `demo:${shared.id}:${claimed.slot}`,
        displayName,
        role: "member",
        draftSlot: claimed.slot,
        teamName: displayName,
        pins: [],
        avoids: [],
        weights: DEFAULT_STRATEGY_WEIGHTS,
        darkMode: true,
      },
      demo: {
        role: "play",
        slot: claimed.slot,
        roomId: shared.id,
        ...(await demoClientState(shared.id)),
      },
      demoToken: token,
    });
    response.cookies.set(DEMO_COOKIE_NAME, token, demoCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to join the demo" },
      { status: 400 },
    );
  }
}
