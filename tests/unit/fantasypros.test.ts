import { describe, expect, it } from "vitest";

import {
  capFantasyProsPage,
  decodeFpName,
  estimatedOverall,
  looksLikeOverallBoard,
  mergeFantasyProsOverall,
  mergeFantasyProsPlayers,
  mergeFantasyProsRankings,
  parseFpPosRank,
} from "../../src/adapters/rankings/fantasypros";

describe("FantasyPros public rankings merge", () => {
  it("uses overall ECR from position=ALL instead of the homemade curve", () => {
    const players = mergeFantasyProsPlayers([
      {
        player_name: "Josh Allen",
        player_position_id: "QB",
        rank_ecr: 15,
        pos_rank: "QB1",
        tier: 3,
        player_bye_week: "7",
      },
      {
        player_name: "Bijan Robinson",
        player_position_id: "RB",
        rank_ecr: 1,
        pos_rank: "RB1",
        tier: 1,
        player_bye_week: 11,
      },
      {
        player_name: "Ja'Marr Chase",
        player_position_id: "WR",
        rank_ecr: 2,
        pos_rank: "WR1",
        tier: 1,
      },
      {
        player_name: "Houston Texans",
        player_position_id: "DST",
        rank_ecr: 140,
        pos_rank: "DST1",
        tier: 10,
      },
    ]);
    expect(looksLikeOverallBoard([
      { rank_ecr: 1 },
      { rank_ecr: 2 },
      { rank_ecr: 15 },
    ])).toBe(true);
    expect(players.map((player) => player.name)).toEqual([
      "Bijan Robinson",
      "Ja'Marr Chase",
      "Josh Allen",
      "Houston Texans",
    ]);
    expect(players.map((player) => player.overallRank)).toEqual([1, 2, 3, 4]);
    expect(players[0]).toMatchObject({
      position: "RB",
      positionRank: 1,
      tier: 1,
      byeWeek: 11,
    });
    expect(players[2]).toMatchObject({
      position: "QB",
      positionRank: 1,
      tier: 3,
      byeWeek: 7,
    });
    expect(players.find((player) => player.position === "DEF")?.name).toBe(
      "Houston Texans",
    );
    expect(estimatedOverall("QB", 1)).toBeGreaterThan(estimatedOverall("RB", 8));
    expect(players.find((player) => player.name === "Josh Allen")?.overallRank).toBe(3);
  });

  it("still stitches per-position pages when every position has an ECR 1", () => {
    const players = mergeFantasyProsPlayers([
      { player_name: "Jahmyr Gibbs", player_position_id: "RB", rank_ecr: 1, tier: 1 },
      { player_name: "Ja'Marr Chase", player_position_id: "WR", rank_ecr: 1, tier: 1 },
      { player_name: "Josh Allen", player_position_id: "QB", rank_ecr: 1, tier: 1 },
      { player_name: "Houston Texans", player_position_id: "DST", rank_ecr: 1, tier: 1 },
      { player_name: "Brandon Aubrey", player_position_id: "K", rank_ecr: 1, tier: 1 },
    ]);
    expect(looksLikeOverallBoard([
      { rank_ecr: 1, player_position_id: "RB" },
      { rank_ecr: 1, player_position_id: "WR" },
      { rank_ecr: 1, player_position_id: "QB" },
    ])).toBe(false);
    expect(players.map((player) => player.position)).toEqual([
      "WR",
      "RB",
      "QB",
      "DEF",
      "K",
    ]);
    expect(players.map((player) => player.overallRank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps a draft-sized slice instead of the full 300-deep position lists", () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      player_name: `WR ${index + 1}`,
      player_position_id: "WR",
      rank_ecr: index + 1,
    }));
    expect(capFantasyProsPage(rows, "WR")).toHaveLength(120);
    expect(capFantasyProsPage(rows, "K")).toHaveLength(32);
    expect(capFantasyProsPage(rows, "ALL")).toHaveLength(200);
    expect(parseFpPosRank("WR12", 99)).toBe(12);
    expect(mergeFantasyProsOverall(rows)).toHaveLength(200);
  });

  it("keeps kickers and defenses behind skill starters on the fallback curve", () => {
    expect(estimatedOverall("RB", 12)).toBeLessThan(estimatedOverall("K", 1));
    expect(estimatedOverall("WR", 20)).toBeLessThan(estimatedOverall("DEF", 1));
    expect(estimatedOverall("QB", 1)).toBeGreaterThan(estimatedOverall("RB", 8));
  });

  it("reads overall ECR from rank.ECR.HALF.ALL on the rankings endpoint", () => {
    expect(decodeFpName("Ja&amp;#39;Marr Chase")).toBe("Ja'Marr Chase");
    const players = mergeFantasyProsRankings(
      [
        {
          player_name: "Josh Allen",
          position_id: "QB",
          team_id: "BUF",
          rank: { ECR: { HALF: { ALL: 31, QB: 1 } } },
        },
        {
          player_name: "Jahmyr Gibbs",
          position_id: "RB",
          team_id: "DET",
          rank: { ECR: { HALF: { ALL: 1, RB: 1 } } },
        },
        {
          player_name: "Ja&amp;#39;Marr Chase",
          position_id: "WR",
          team_id: "CIN",
          rank: { ECR: { HALF: { ALL: 3, WR: 1 } } },
        },
        {
          player_name: "Brock Bowers",
          position_id: "TE",
          team_id: "LV",
          rank: { ECR: { HALF: { ALL: 18, TE: 1 } } },
        },
      ],
      "HALF",
    );
    expect(players.map((player) => player.name)).toEqual([
      "Jahmyr Gibbs",
      "Ja'Marr Chase",
      "Brock Bowers",
      "Josh Allen",
    ]);
    expect(players[0]).toMatchObject({
      overallRank: 1,
      position: "RB",
      positionRank: 1,
    });
    expect(players[3]).toMatchObject({
      overallRank: 4,
      position: "QB",
      positionRank: 1,
    });
  });
});
