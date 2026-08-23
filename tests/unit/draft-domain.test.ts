import { describe, expect, it } from "vitest";

import {
  assignRosterSlot,
  createDraftState,
  extendDraftWithRemotePlayers,
  makeManualPick,
  opponentPick,
  simulateToUserTurn,
  openStarterSlots,
  overallPickFor,
  picksForSlot,
  picksUntilFollowingSelection,
  selectionForOverall,
  shouldApplySyncUpdate,
  createStaleSyncGuard,
  undoLastPick,
  type Pick,
  type Player,
} from "../../src/domain";

const player = (
  id: string,
  position: Player["position"],
  overrides: Partial<Player> = {},
): Player => ({
  id,
  name: `Player ${id}`,
  position,
  team: "BUF",
  chenRank: Number(id.replace(/\D/g, "")) || 1,
  chenTier: 1,
  ...overrides,
});

const pick = (
  overall: number,
  rosterSlot: Pick["rosterSlot"],
  selectedPlayer: Player,
): Pick => ({
  overall,
  round: 1,
  slot: 1,
  rosterSlot,
  player: selectedPlayer,
});

describe("12-team snake calculations", () => {
  it("calculates and reverses every slot across odd and even rounds", () => {
    for (let slot = 1; slot <= 12; slot += 1) {
      for (let round = 1; round <= 15; round += 1) {
        const overall = overallPickFor(round, slot);
        expect(selectionForOverall(overall, 12)).toEqual({ overall, round, slot });
      }
    }
  });

  it("returns each slot's complete pick sequence", () => {
    expect(picksForSlot(1, 4).map((selection) => selection.overall)).toEqual([
      1, 24, 25, 48,
    ]);
    expect(picksForSlot(12, 4).map((selection) => selection.overall)).toEqual([
      12, 13, 36, 37,
    ]);
  });

  it("counts opposing picks until the following selection for every slot", () => {
    for (let slot = 1; slot <= 12; slot += 1) {
      expect(picksUntilFollowingSelection(1, slot)).toBe(2 * (12 - slot));
      const secondPick = overallPickFor(2, slot);
      expect(picksUntilFollowingSelection(secondPick, slot)).toBe(2 * (slot - 1));
    }
  });

  it("validates impossible values", () => {
    expect(() => overallPickFor(1, 0)).toThrow(RangeError);
    expect(() => selectionForOverall(0, 12)).toThrow(RangeError);
  });
});

describe("8-team snake calculations", () => {
  it("reverses every slot across odd and even rounds", () => {
    for (let slot = 1; slot <= 8; slot += 1) {
      for (let round = 1; round <= 15; round += 1) {
        const overall = overallPickFor(round, slot, 8);
        expect(selectionForOverall(overall, 8)).toEqual({ overall, round, slot });
      }
    }
  });

  it("gives slot 1 pick 16 at the round-2 turnaround, not a 12-team slot", () => {
    expect(selectionForOverall(16, 8)).toEqual({
      overall: 16,
      round: 2,
      slot: 1,
    });
    expect(picksForSlot(1, 4, 8).map((selection) => selection.overall)).toEqual([
      1, 16, 17, 32,
    ]);
    // The old UI defaulted this helper to 12 teams, so pick 16 looked like
    // someone else's turn and the confirm button stayed disabled.
    expect(selectionForOverall(16, 12).slot).toBe(9);
  });
});

describe("roster assignment", () => {
  it("fills direct starters, FLEX, and then bench", () => {
    const picks: Pick[] = [
      pick(1, "RB", player("1", "RB")),
      pick(2, "RB", player("2", "RB")),
    ];
    expect(assignRosterSlot(player("3", "RB"), picks)).toBe("FLEX");
    picks.push(pick(3, "FLEX", player("3", "RB")));
    expect(assignRosterSlot(player("4", "RB"), picks)).toBe("BENCH");
  });

  it("supports the exact starter shape and six bench slots", () => {
    const picks: Pick[] = [
      pick(1, "QB", player("1", "QB")),
      pick(2, "RB", player("2", "RB")),
      pick(3, "RB", player("3", "RB")),
      pick(4, "WR", player("4", "WR")),
      pick(5, "WR", player("5", "WR")),
      pick(6, "TE", player("6", "TE")),
      pick(7, "FLEX", player("7", "WR")),
      pick(8, "K", player("8", "K")),
      pick(9, "DEF", player("9", "DEF")),
    ];
    expect(openStarterSlots(picks)).toEqual([]);
    for (let index = 0; index < 6; index += 1) {
      picks.push(pick(10 + index, "BENCH", player(`1${index}`, "WR")));
    }
    expect(assignRosterSlot(player("20", "WR"), picks)).toBeNull();
    expect(
      assignRosterSlot(player("20", "WR"), picks, { overflowBench: true }),
    ).toBe("BENCH");
  });

  it("records a 15-round team even when BPA stacks one position", () => {
    let state = createDraftState(1, { teamCount: 1, rounds: 15 });
    for (let index = 1; index <= 15; index += 1) {
      state = makeManualPick(state, player(String(index), "WR"));
    }
    expect(state.picks).toHaveLength(15);
    expect(state.picks.filter((entry) => entry.rosterSlot === "BENCH").length).toBe(12);
  });

  it("uses IR only for an IR-eligible player and keeps it outside active capacity", () => {
    expect(
      assignRosterSlot(player("1", "RB", { injuryStatus: "IR" }), []),
    ).toBe("IR");
    expect(
      assignRosterSlot(player("2", "RB", { injuryStatus: "OUT" }), []),
    ).toBe("RB");
    expect(
      assignRosterSlot(player("3", "RB", { injuryStatus: "IR" }), [], {
        allowIr: false,
      }),
    ).toBe("RB");
  });
});

describe("manual picks and undo", () => {
  it("adds picks immutably using snake ownership", () => {
    const initial = createDraftState(4);
    const first = makeManualPick(initial, player("1", "RB"));
    expect(initial.picks).toEqual([]);
    expect(first).not.toBe(initial);
    expect(first.picks[0]).toMatchObject({ overall: 1, round: 1, slot: 1 });

    let state = first;
    for (let index = 2; index <= 13; index += 1) {
      state = makeManualPick(state, player(String(index), "WR"));
    }
    expect(state.picks[11]).toMatchObject({ overall: 12, round: 1, slot: 12 });
    expect(state.picks[12]).toMatchObject({ overall: 13, round: 2, slot: 12 });
  });

  it("rejects duplicate players and cleanly undoes the final pick", () => {
    const initial = createDraftState(1);
    const selected = player("1", "QB");
    const drafted = makeManualPick(initial, selected);
    expect(() => makeManualPick(drafted, selected)).toThrow("already been drafted");
    const undone = undoLastPick(drafted);
    expect(undone.picks).toEqual([]);
    expect(drafted.picks).toHaveLength(1);
    expect(undoLastPick(initial)).toBe(initial);
  });
});

describe("stale synchronization guard", () => {
  it("accepts only newer revisions or a newer timestamp tie-breaker", () => {
    const current = { sequence: 3, updatedAt: "2026-08-08T12:00:00Z" };
    expect(shouldApplySyncUpdate(current, { sequence: 2 })).toBe(false);
    expect(shouldApplySyncUpdate(current, { sequence: 3 })).toBe(false);
    expect(
      shouldApplySyncUpdate(current, {
        sequence: 3,
        updatedAt: "2026-08-08T12:01:00Z",
      }),
    ).toBe(true);
    expect(shouldApplySyncUpdate(current, { sequence: 4 })).toBe(true);
  });

  it("tracks the last accepted revision without exposing mutation", () => {
    const guard = createStaleSyncGuard();
    expect(guard.accept({ sequence: 1 })).toBe(true);
    expect(guard.accept({ sequence: 1 })).toBe(false);
    expect(guard.accept({ sequence: 0 })).toBe(false);
    expect(guard.current()).toEqual({ sequence: 1 });
  });
});

describe("shared opponent simulation", () => {
  it("appends a pick without dropping existing selections", () => {
    let state = createDraftState(5);
    state = makeManualPick(state, player("1", "WR"));
    const next = opponentPick(state, [
      player("1", "WR"),
      player("2", "RB"),
      player("3", "TE"),
    ]);
    expect(next.picks).toHaveLength(2);
    expect(next.picks[0].player.id).toBe("1");
    expect(next.picks[1].player.id).toBe("2");
  });

  it("simulates only until the user slot", () => {
    const pool = Array.from({ length: 12 }, (_, index) =>
      player(String(index + 1), "WR"),
    );
    const next = simulateToUserTurn(createDraftState(3), pool);
    expect(next.picks).toHaveLength(2);
    expect(next.picks.map((item) => item.slot)).toEqual([1, 2]);
  });
});

describe("remote pick reconcile", () => {
  it("appends when the remote order continues this board", () => {
    const first = player("1", "RB");
    const second = player("2", "WR");
    const current = makeManualPick(createDraftState(1, { teamCount: 4, rounds: 3 }), first);
    const next = extendDraftWithRemotePlayers(current, [first, second]);
    expect(next.rebuilt).toBe(false);
    expect(next.applied).toBe(1);
    expect(next.draft.picks.map((item) => item.player.id)).toEqual(["1", "2"]);
  });

  it("rebuilds when a later remote pick was already on the board", () => {
    const warren = player("chen:TE:tyler warren", "TE", { name: "Tyler Warren" });
    const other = player("2", "WR");
    let current = makeManualPick(
      createDraftState(1, { teamCount: 4, rounds: 3 }),
      warren,
    );
    current = makeManualPick(current, other);
    const remote = [other, player("3", "RB"), warren];
    const next = extendDraftWithRemotePlayers(current, remote);
    expect(next.rebuilt).toBe(true);
    expect(next.draft.picks.map((item) => item.player.id)).toEqual([
      "2",
      "3",
      "chen:TE:tyler warren",
    ]);
  });
});
