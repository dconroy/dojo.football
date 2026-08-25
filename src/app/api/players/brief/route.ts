import { NextResponse } from "next/server";
import { AuthError, requireActiveUser } from "@/auth/current-user";
import { getDemoClaims } from "@/auth/demo-session";
import { loadPlayerBrief } from "@/adapters/sleeper/player-brief";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    try {
      await requireActiveUser();
    } catch (error) {
      if (!(error instanceof AuthError) || !(await getDemoClaims(request))) throw error;
    }
    const url = new URL(request.url);
    const name = url.searchParams.get("name")?.trim();
    const position = url.searchParams.get("position")?.trim();
    if (!name || !position) {
      return NextResponse.json(
        { error: "name and position required" },
        { status: 400 },
      );
    }
    const brief = await loadPlayerBrief(name, position);
    return NextResponse.json(brief);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to load player brief" }, { status: 500 });
  }
}
