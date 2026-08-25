import { NextResponse, type NextRequest } from "next/server";
import {
  DEMO_COOKIE_NAME,
  createDemoToken,
  demoCookieOptions,
} from "@/auth/demo-session";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";
import { draftStateFor } from "@/persistence/league-draft";
import {
  createDemoRoom,
  demoClientState,
  demoSeatMembers,
  validateDemoRoomInput,
} from "@/persistence/demo-rooms";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      scoring?: unknown;
      teamCount?: unknown;
      rounds?: unknown;
      slot?: unknown;
      displayName?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json(
        { error: "Draft settings are required" },
        { status: 400 },
      );
    }
    const settings = validateDemoRoomInput(body);
    const { shared, slot, sessionId } = await createDemoRoom(settings);
    const token = await createDemoToken({
      roomId: shared.id,
      slot,
      role: "play",
      sessionId,
    });
    const response = NextResponse.json({
      ...shared,
      draft: draftStateFor(shared, slot),
      members: await demoSeatMembers(shared.id),
      me: {
        id: `demo:${shared.id}:${slot}`,
        displayName: settings.displayName,
        role: "member",
        draftSlot: slot,
        teamName: settings.displayName,
        pins: [],
        avoids: [],
        weights: DEFAULT_STRATEGY_WEIGHTS,
        darkMode: true,
      },
      demo: {
        role: "play",
        slot,
        roomId: shared.id,
        ...(await demoClientState(shared.id)),
      },
      demoToken: token,
    });
    response.cookies.set(DEMO_COOKIE_NAME, token, demoCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to create the demo draft",
      },
      { status: 400 },
    );
  }
}
