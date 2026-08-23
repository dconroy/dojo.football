import { describe, expect, it } from "vitest";

import {
  adpSurvivalProbability,
  analyzeRoomTendencies,
  availabilitySignal,
  createDraftState,
  estimatePlayerAvailability,
  makeManualPick,
  type DraftState,
  type Player,
} from "../../src/domain";

function player(
  id: string,
  position: Player["position"],
  rank: number,
  overrides: Partial<Player> = {},
): Player {
  return {
    id,
    name: id,
    position,
    team: "BUF",
    chenRank: rank,
    chenTier: Math.ceil(rank / 12),
    adp: rank,
    ...overrides,
  };
}

function draftPlayers(
  state: DraftState,
  positions: readonly Player["position"][],
): DraftState {
  return positions.reduce(
    (current, position, index) =>
      makeManualPick(current, player(`${position}-${index}`, position, index + 1)),
    state,
  );
}

describe("room tendencies", () => {
  it("detects a current positional run", () => {
    const state = draftPlayers(createDraftState(1), ["RB", "RB", "WR", "RB", "RB"]);
    expect(analyzeRoomTendencies(state).run).toMatchObject({
      position: "RB",
      picks: 4,
      window: 5,
    });
  });

  it("finds lineup demand among teams picking between turns", () => {
    const state = draftPlayers(createDraftState(1), [
      "QB",
      "WR",
      "WR",
      "WR",
      "WR",
      "WR",
      "WR",
      "WR",
      "WR",
      "WR",
      "WR",
      "WR",
    ]);
    const room = analyzeRoomTendencies(state);
    expect(room.window).toHaveLength(0);

    const middleSlot = draftPlayers(createDraftState(6), [
      "QB",
      "WR",
      "WR",
      "WR",
      "WR",
      "WR",
    ]);
    const demand = analyzeRoomTendencies(middleSlot).demand.find(
      (item) => item.position === "RB",
    );
    expect(demand?.picksInWindow).toBeGreaterThan(0);
    expect(demand?.teamsNeeding).toBeGreaterThan(0);
  });

  it("labels only established team biases", () => {
    const state: DraftState = {
      ...createDraftState(1),
      picks: [1, 2, 3, 4].map((overall) => ({
        overall,
        round: overall,
        slot: 2,
        rosterSlot: overall <= 2 ? ("RB" as const) : ("BENCH" as const),
        player: player(`rb-${overall}`, "RB", overall),
      })),
    };
    expect(analyzeRoomTendencies(state).biases[0]).toMatchObject({
      slot: 2,
      position: "RB",
      count: 4,
    });
  });
});

describe("pick availability", () => {
  it("keeps the established ADP survival curve", () => {
    expect(adpSurvivalProbability(player("rb", "RB", 20), 20)).toBeCloseTo(0.5);
    expect(
      adpSurvivalProbability(
        player("override", "WR", 20, { estimatedReturnProbability: 0.13 }),
        40,
      ),
    ).toBe(0.13);
  });

  it("returns clear take-now and wait signals", () => {
    expect(availabilitySignal(0.25)).toBe("take_now");
    expect(availabilitySignal(0.5, 0.8)).toBe("take_now");
    expect(availabilitySignal(0.8, 0.1)).toBe("safe_to_wait");
    expect(availabilitySignal(null)).toBe("unknown");
  });

  it("lowers availability when the room has strong positional pressure", () => {
    const candidate = player("candidate", "RB", 25);
    const alternatives = [
      candidate,
      player("next-rb", "RB", 45),
      player("wr", "WR", 26),
    ];
    const state = draftPlayers(createDraftState(6), [
      "QB",
      "WR",
      "WR",
      "WR",
      "WR",
      "WR",
    ]);
    const estimate = estimatePlayerAvailability(candidate, state, alternatives);
    const baseline = adpSurvivalProbability(candidate, estimate.targetOverall);
    expect(estimate.probability).not.toBeNull();
    expect(estimate.probability!).toBeLessThan(baseline!);
    expect(estimate.reasons.some((reason) => reason.includes("RB need"))).toBe(true);
  });
});
