import { describe, expect, it } from "vitest";

import type { ChenImport, ChenPlayerRecord } from "../../src/adapters/chen/boris-chen";
import {
  blendRankingImports,
  DEFAULT_BLEND_WEIGHTS,
  MAX_BLEND_PLAYERS,
  rankToPercentile,
  renormalizeWeights,
  thinConsensusPenalty,
} from "../../src/adapters/rankings/blend";

function record(
  name: string,
  position: ChenPlayerRecord["position"],
  overallRank: number,
  extras: Partial<ChenPlayerRecord> = {},
): ChenPlayerRecord {
  return {
    sourceId: `test:${position}:${name.toLowerCase()}`,
    name,
    position,
    team: extras.team ?? "CIN",
    tier: extras.tier ?? 1,
    positionRank: extras.positionRank ?? overallRank,
    overallRank,
    byeWeek: extras.byeWeek,
    adp: extras.adp,
  };
}

function imported(
  players: ChenPlayerRecord[],
  source = "test",
): ChenImport {
  return {
    players,
    importedAt: "2026-08-23T00:00:00.000Z",
    source,
    warnings: [],
    scoring: "half-ppr",
  };
}

describe("ranking blend math", () => {
  it("caps the union at draft-useful depth", () => {
    const deep = Array.from({ length: MAX_BLEND_PLAYERS + 50 }, (_, index) =>
      record(`Player ${index + 1}`, index % 2 === 0 ? "RB" : "WR", index + 1),
    );
    const blended = blendRankingImports({ sleeper: imported(deep) });
    expect(blended?.players).toHaveLength(MAX_BLEND_PLAYERS);
    expect(blended?.players.at(-1)?.overallRank).toBe(MAX_BLEND_PLAYERS);
  });

  it("assigns useful rank-banded tiers instead of marking the board Tier 1", () => {
    const board = Array.from({ length: 36 }, (_, index) =>
      record(`Player ${index + 1}`, index % 2 === 0 ? "RB" : "WR", index + 1),
    );
    const blended = blendRankingImports({ chen: imported(board) });
    expect(blended?.players[0]?.tier).toBe(1);
    expect(blended?.players[11]?.tier).toBe(1);
    expect(blended?.players[12]?.tier).toBe(2);
    expect(blended?.players[35]?.tier).toBe(3);
  });

  it("maps rank 1 to percentile 0 and last place to 1", () => {
    expect(rankToPercentile(1, 100)).toBe(0);
    expect(rankToPercentile(100, 100)).toBe(1);
    expect(rankToPercentile(51, 101)).toBe(0.5);
  });

  it("renormalizes leftover weights when a source is missing", () => {
    const next = renormalizeWeights(DEFAULT_BLEND_WEIGHTS, ["chen", "sleeper"]);
    expect(next.fantasypros).toBe(0);
    expect(next.ffcalc).toBe(0);
    expect(next.chen + next.sleeper).toBeCloseTo(1);
    expect(next.chen / next.sleeper).toBeCloseTo(
      DEFAULT_BLEND_WEIGHTS.chen / DEFAULT_BLEND_WEIGHTS.sleeper,
    );
  });

  it("penalizes thin consensus and leaves full-list players alone", () => {
    expect(thinConsensusPenalty(4, 4)).toBe(0);
    expect(thinConsensusPenalty(1, 1)).toBe(0);
    expect(thinConsensusPenalty(1, 4)).toBeGreaterThan(thinConsensusPenalty(3, 4));
  });

  it("merges the same player identity across lists into one row", () => {
    const chase = record("Ja'Marr Chase", "WR", 1, { adp: 1.4 });
    const blended = blendRankingImports({
      chen: imported([chase, record("Bijan Robinson", "RB", 2)]),
      sleeper: imported([
        record("Ja'Marr Chase", "WR", 2, { adp: 1.8 }),
        record("Bijan Robinson", "RB", 1, { adp: 2.1 }),
      ]),
    });
    expect(blended?.players).toHaveLength(2);
    expect(blended?.source).toMatch(/^Dojo blend · Chen \+ Sleeper/);
    const names = blended!.players.map((player) => player.name);
    expect(new Set(names).size).toBe(2);
  });

  it("keeps ADP from Sleeper, then FFCalc, never expert ranks", () => {
    const blended = blendRankingImports({
      chen: imported([record("Ja'Marr Chase", "WR", 1, { adp: 99 })]),
      fantasypros: imported([record("Ja'Marr Chase", "WR", 1, { adp: 88 })]),
      sleeper: imported([record("Ja'Marr Chase", "WR", 1, { adp: 1.6 })]),
      ffcalc: imported([record("Ja'Marr Chase", "WR", 1, { adp: 3.2 })]),
    });
    expect(blended?.players[0]?.adp).toBe(1.6);

    const withoutSleeper = blendRankingImports({
      chen: imported([record("Ja'Marr Chase", "WR", 1, { adp: 99 })]),
      ffcalc: imported([record("Ja'Marr Chase", "WR", 1, { adp: 3.2 })]),
    });
    expect(withoutSleeper?.players[0]?.adp).toBe(3.2);
  });

  it("does not let a one-list name outrank a three-source consensus at the top", () => {
    const ace = record("Consensus Ace", "WR", 1);
    const board = [
      ace,
      record("Solid Two", "RB", 2),
      record("Solid Three", "RB", 3),
    ];
    const blended = blendRankingImports({
      chen: imported(board),
      fantasypros: imported(board),
      sleeper: imported(board),
      ffcalc: imported([
        record("One List Wonder", "WR", 1),
        ace,
        record("Solid Two", "RB", 3),
      ]),
    });
    const names = blended!.players.map((player) => player.name);
    expect(names[0]).toBe("Consensus Ace");
    expect(names).toContain("One List Wonder");
    expect(names.indexOf("Consensus Ace")).toBeLessThan(
      names.indexOf("One List Wonder"),
    );
  });
});
