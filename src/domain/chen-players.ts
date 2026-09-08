import type { Player, Position } from "./types";

const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

interface ChenShapedPlayer {
  readonly sourceId: string;
  readonly name: string;
  readonly position: string;
  readonly team?: string;
  readonly overallRank?: number;
  readonly tier?: number;
  readonly byeWeek?: number;
  readonly adp?: number;
}

/** Map a Chen import into the Player pool the recommender already scores. */
export function playersFromChenImport(imported: {
  readonly players?: readonly ChenShapedPlayer[];
} | null | undefined): Player[] {
  if (!imported?.players?.length) return [];
  return imported.players.flatMap((player) => {
    if (!POSITIONS.has(player.position)) return [];
    return [
      {
        id: player.sourceId,
        name: player.name,
        position: player.position as Position,
        team: player.team ?? "FA",
        chenRank: player.overallRank,
        chenTier: player.tier,
        byeWeek: player.byeWeek,
        adp: player.adp,
      },
    ];
  });
}
