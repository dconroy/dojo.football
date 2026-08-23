import { describe, expect, it } from "vitest";

import {
  capFantasyProsPage,
  estimatedOverall,
  mergeFantasyProsPlayers,
} from "../../src/adapters/rankings/fantasypros";

describe("FantasyPros public rankings merge", () => {
  it("maps DST to DEF and assigns unique overall ranks", () => {
    const players = mergeFantasyProsPlayers([
      { player_name: "Jahmyr Gibbs", player_position_id: "RB", rank_ecr: 1, tier: 1 },
      { player_name: "Ja'Marr Chase", player_position_id: "WR", rank_ecr: 1, tier: 1 },
      { player_name: "Josh Allen", player_position_id: "QB", rank_ecr: 1, tier: 1 },
      { player_name: "Houston Texans", player_position_id: "DST", rank_ecr: 1, tier: 1 },
      { player_name: "Brandon Aubrey", player_position_id: "K", rank_ecr: 1, tier: 1 },
    ]);
    expect(players.map((player) => player.position)).toEqual([
      "WR",
      "RB",
      "QB",
      "DEF",
      "K",
    ]);
    expect(players.map((player) => player.overallRank)).toEqual([1, 2, 3, 4, 5]);
    expect(players.find((player) => player.position === "DEF")?.name).toBe(
      "Houston Texans",
    );
  });

  it("keeps a draft-sized slice instead of the full 300-deep position lists", () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      player_name: `WR ${index + 1}`,
      player_position_id: "WR",
      rank_ecr: index + 1,
    }));
    expect(capFantasyProsPage(rows, "WR")).toHaveLength(120);
    expect(capFantasyProsPage(rows, "K")).toHaveLength(32);
  });

  it("keeps kickers and defenses behind skill starters", () => {
    expect(estimatedOverall("RB", 12)).toBeLessThan(estimatedOverall("K", 1));
    expect(estimatedOverall("WR", 20)).toBeLessThan(estimatedOverall("DEF", 1));
    expect(estimatedOverall("QB", 1)).toBeGreaterThan(estimatedOverall("RB", 8));
  });
});
