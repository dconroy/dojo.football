import { describe, expect, it } from "vitest";

import {
  draftBoardExhausted,
  draftIsFinished,
  draftSizeNote,
  requiredPickCount,
  shortBoardMessage,
  uniquePlayerCount,
} from "../../src/domain/draft-capacity";
import { mergeExtraRankedPlayers } from "../../src/adapters/rankings/extend-board";
import type { ChenPlayerRecord } from "../../src/adapters/chen/boris-chen";

const player = (
  overrides: Partial<ChenPlayerRecord> & Pick<ChenPlayerRecord, "name" | "position">,
): ChenPlayerRecord => ({
  sourceId: `${overrides.position}:${overrides.name}`,
  tier: 8,
  positionRank: 20,
  overallRank: 180,
  ...overrides,
});

describe("draft capacity", () => {
  it("counts unique players and required picks", () => {
    expect(requiredPickCount(14, 16)).toBe(224);
    expect(
      uniquePlayerCount([
        { id: "a" },
        { id: "a" },
        { id: "b" },
        { sourceId: "c" },
      ]),
    ).toBe(3);
  });

  it("treats an emptied board as finished even if rounds remain", () => {
    const short = { picks: 200, playerCount: 200, teamCount: 14, rounds: 16 };
    expect(draftBoardExhausted(short)).toBe(true);
    expect(draftIsFinished(short)).toBe(true);
    expect(
      draftBoardExhausted({ picks: 224, playerCount: 250, teamCount: 14, rounds: 16 }),
    ).toBe(false);
    expect(
      draftIsFinished({ picks: 224, playerCount: 250, teamCount: 14, rounds: 16 }),
    ).toBe(true);
  });

  it("explains a short ranking list", () => {
    expect(shortBoardMessage(180, 14, 16)).toMatch(/needs 224 players/);
    expect(draftSizeNote(14, 16)).toMatch(/224 picks/);
    expect(draftSizeNote(10, 12)).toBe("120 picks in this room.");
  });
});

describe("mergeExtraRankedPlayers", () => {
  it("appends only new names and keeps them behind the main board", () => {
    const base = [
      player({ name: "Bijan Robinson", position: "RB", overallRank: 1 }),
      player({ name: "Ja'Marr Chase", position: "WR", overallRank: 2 }),
    ];
    const merged = mergeExtraRankedPlayers(base, [
      player({ name: "Bijan Robinson", position: "RB", overallRank: 4 }),
      player({ name: "Romeo Doubs", position: "WR", overallRank: 90 }),
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[2]?.name).toBe("Romeo Doubs");
    expect(merged[2]?.overallRank).toBe(3);
  });
});
