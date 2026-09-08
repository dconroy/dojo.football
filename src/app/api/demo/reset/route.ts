import { NextResponse, type NextRequest } from "next/server";
import { AuthError } from "@/auth/current-user";
import { requireBoardAccess, requireDemoPlayer } from "@/auth/board-access";
import { boardPayload } from "@/persistence/draft-payload";
import { resetDemoDraft } from "@/persistence/demo-rooms";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { draftId, user, demo } = await requireBoardAccess(request);
    const player = await requireDemoPlayer(draftId, demo);
    if (!player.sessionId) {
      throw new AuthError("Choose an open demo seat first", 403);
    }
    await resetDemoDraft(draftId, player.sessionId);
    return NextResponse.json(await boardPayload(draftId, user, demo));
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to reset the demo draft",
      },
      { status: 400 },
    );
  }
}
