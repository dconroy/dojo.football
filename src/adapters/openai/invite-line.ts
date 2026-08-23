import { generateInviteLine, openaiConfigured } from "./draft-story";
import { saveInviteLine } from "@/persistence/league-draft";

export async function maybeWriteInviteLine(input: {
  readonly draftId: string;
  readonly host: string;
  readonly teamCount: number;
  readonly rounds: number;
  readonly scoring: string;
  readonly slot: number;
}): Promise<string | null> {
  if (!openaiConfigured()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const line = await generateInviteLine(
      {
        host: input.host,
        teamCount: input.teamCount,
        rounds: input.rounds,
        scoring: input.scoring,
        slot: input.slot,
      },
      { signal: controller.signal },
    );
    await saveInviteLine(input.draftId, line);
    return line;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
