import { NextResponse } from "next/server";
import {
  DEMO_COOKIE_NAME,
  createDemoToken,
  demoCookieOptions,
  getDemoClaims,
} from "@/auth/demo-session";
import { prisma } from "@/persistence/prisma";
import { draftStateFor } from "@/persistence/league-draft";
import {
  demoClientState,
  demoSeatMembers,
  findOrCreateOpenDemoRoom,
  releaseDemoSeat,
  syncDemoBoardFromMock,
  validateDemoSeat,
} from "@/persistence/demo-rooms";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";

export const runtime = "nodejs";

function demoMe(
  roomId: string,
  slot: number | null,
  role: "watch" | "play",
  displayName?: string,
) {
  const name =
    role === "play" ? displayName || "Human" : "Spectator";
  return {
    id: `demo:${roomId}:${role === "play" ? slot : "spectator"}`,
    displayName: name,
    role: "member" as const,
    draftSlot: slot ?? 0,
    teamName: role === "play" ? name : "Watching",
    pins: [] as string[],
    avoids: [] as string[],
    weights: DEFAULT_STRATEGY_WEIGHTS,
    darkMode: true,
  };
}

async function roomIsReal(roomId: string): Promise<boolean> {
  const row = await prisma.leagueDraft.findUnique({
    where: { id: roomId },
    select: { leagueKey: true },
  });
  return Boolean(row?.leagueKey);
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const requestedRoom = searchParams.get("room")?.trim() || null;
    const joiningFromInvite = searchParams.get("join") === "1";
    const existing = await getDemoClaims(request);
    // Resume an existing claim only when no other room was explicitly requested
    // and the claimed room still exists as a real (mock-config) room. An invite
    // always starts at seat selection, even if this browser has a prior claim.
    if (
      !joiningFromInvite &&
      existing &&
      (!requestedRoom || requestedRoom === existing.roomId)
    ) {
      const seatIsValid =
        existing.role === "watch" ||
        (await validateDemoSeat(
          existing.roomId,
          existing.slot,
          existing.sessionId,
        ));
      if (seatIsValid && (await roomIsReal(existing.roomId))) {
        const token = await createDemoToken({
          roomId: existing.roomId,
          slot: existing.slot,
          role: existing.role,
          sessionId: existing.sessionId,
        });
        const shared = await syncDemoBoardFromMock(existing.roomId);
        const members = await demoSeatMembers(existing.roomId);
        const member = members.find(
          (candidate) => candidate.draftSlot === existing.slot,
        );
        return NextResponse.json({
          ...shared,
          draft: draftStateFor(shared, existing.slot ?? 0),
          members,
          me: demoMe(
            existing.roomId,
            existing.slot,
            existing.role,
            member?.displayName,
          ),
          demo: {
            role: existing.role,
            slot: existing.slot,
            roomId: existing.roomId,
            ...(await demoClientState(existing.roomId)),
          },
          demoToken: token,
        });
      }
    }
    if (
      joiningFromInvite &&
      existing?.role === "play" &&
      existing.roomId === requestedRoom
    ) {
      await releaseDemoSeat(
        existing.roomId,
        existing.slot,
        existing.sessionId,
      );
    }
    // Honor an explicit ?room= target when it's a real room; else matchmake.
    const shared =
      requestedRoom && (await roomIsReal(requestedRoom))
        ? await syncDemoBoardFromMock(requestedRoom)
        : (await findOrCreateOpenDemoRoom()).shared;
    const token = await createDemoToken({
      roomId: shared.id,
      slot: null,
      role: "watch",
      sessionId: null,
    });
    const members = await demoSeatMembers(shared.id);
    const response = NextResponse.json({
      ...shared,
      draft: draftStateFor(shared, 0),
      members,
      me: demoMe(shared.id, null, "watch"),
      demo: {
        role: "watch",
        slot: null,
        roomId: shared.id,
        ...(await demoClientState(shared.id)),
      },
      demoToken: token,
    });
    response.cookies.set(DEMO_COOKIE_NAME, token, demoCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to open a demo room" },
      { status: 500 },
    );
  }
}
