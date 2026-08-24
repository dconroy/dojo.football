import { createDraftState, makeManualPick } from "./draft";
import type { DraftState, Player } from "./types";

export function rebuildDraftFromPlayers(
  template: Pick<DraftState, "userSlot" | "teamCount" | "rounds">,
  players: readonly Player[],
  madeAt?: string,
): DraftState {
  let draft = createDraftState(template.userSlot, {
    teamCount: template.teamCount,
    rounds: template.rounds,
  });
  const seen = new Set<string>();
  for (const player of players) {
    if (seen.has(player.id)) continue;
    seen.add(player.id);
    draft = makeManualPick(draft, player, { madeAt });
  }
  return draft;
}

/**
 * Append remote picks when they continue this board, or rebuild from the remote
 * order when the sequences have diverged (same player twice, different prefix).
 */
export function extendDraftWithRemotePlayers(
  current: DraftState,
  remotePlayers: readonly Player[],
  madeAt?: string,
  allowRebuild = true,
): { draft: DraftState; applied: number; rebuilt: boolean } {
  const prefix = Math.min(current.picks.length, remotePlayers.length);
  for (let index = 0; index < prefix; index += 1) {
    if (current.picks[index]?.player.id !== remotePlayers[index]?.id) {
      if (!allowRebuild) {
        throw new Error(`remote order differs at pick ${index + 1}`);
      }
      const draft = rebuildDraftFromPlayers(current, remotePlayers, madeAt);
      return { draft, applied: draft.picks.length, rebuilt: true };
    }
  }
  if (remotePlayers.length <= current.picks.length) {
    return { draft: current, applied: 0, rebuilt: false };
  }

  let draft = current;
  let applied = 0;
  for (const player of remotePlayers.slice(current.picks.length)) {
    if (draft.picks.some((pick) => pick.player.id === player.id)) {
      if (!allowRebuild) {
        throw new Error("remote order repeats an existing player");
      }
      const rebuilt = rebuildDraftFromPlayers(current, remotePlayers, madeAt);
      return { draft: rebuilt, applied: rebuilt.picks.length, rebuilt: true };
    }
    draft = makeManualPick(draft, player, { madeAt });
    applied += 1;
  }
  return { draft, applied, rebuilt: false };
}
