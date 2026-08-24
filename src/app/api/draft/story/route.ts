import { NextResponse } from "next/server";
import { AuthError } from "@/auth/current-user";
import { requireBoardAccess } from "@/auth/board-access";
import {
  generateDraftStory,
  openaiConfigured,
} from "@/adapters/openai/draft-story";
import {
  buildDraftReport,
  cachedDraftStory,
  formatDraftStoryFacts,
  packDraftStoryFacts,
} from "@/domain";
import {
  draftStateFor,
  getOrCreateLeagueDraft,
  readDraftStories,
  saveDraftStoryCopy,
  userPrefs,
} from "@/persistence/league-draft";
import { demoSeatMembers } from "@/persistence/demo-rooms";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { draftId, user, demo } = await requireBoardAccess(request);
    const slot = demo
      ? demo.role === "play" && demo.slot
        ? demo.slot
        : null
      : user?.draftSlot && user.draftSlot >= 1
        ? user.draftSlot
        : null;
    if (!slot) {
      return NextResponse.json({ story: null });
    }

    const shared = await getOrCreateLeagueDraft(draftId);
    const report = buildDraftReport(draftStateFor(shared, slot));
    if (!report.complete) {
      return NextResponse.json({ story: null });
    }
    const team = report.teams.find((entry) => entry.slot === slot);
    if (!team) {
      return NextResponse.json({ story: null });
    }

    const pickCount = shared.picks.length;
    const cached = cachedDraftStory(await readDraftStories(draftId), slot, pickCount);
    if (cached) {
      return NextResponse.json({ story: cached.text });
    }

    if (!openaiConfigured()) {
      return NextResponse.json({ story: null });
    }

    const teamName = demo
      ? (await demoSeatMembers(draftId)).find((member) => member.draftSlot === slot)
          ?.teamName ?? `Slot ${slot}`
      : user
        ? userPrefs(user).teamName
        : `Slot ${slot}`;
    const facts = packDraftStoryFacts(team, teamName, report.teams.length);
    const copy = await generateDraftStory(formatDraftStoryFacts(facts));
    await saveDraftStoryCopy(draftId, slot, pickCount, copy.story);
    return NextResponse.json({ story: copy.story });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ story: null });
  }
}
