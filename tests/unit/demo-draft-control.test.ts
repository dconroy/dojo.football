import { describe, expect, it } from "vitest";

import type { MockDraftConfig } from "../../src/adapters/yahoo/mock-runner";
import type { Player } from "../../src/domain";
import {
  buildResetDemoConfig,
  demoBoardIsComplete,
  demoResetAllowed,
} from "../../src/persistence/demo-rooms";

const player = (id: string): Player => ({
  id,
  name: id,
  position: "RB",
  team: "ATL",
  chenRank: 1,
});

function config(
  overrides: Partial<MockDraftConfig> = {},
): MockDraftConfig {
  return {
    leagueKey: "mock.demo.room-1",
    teamCount: 2,
    rounds: 2,
    intervalMs: 3000,
    startedAtIso: new Date().toISOString(),
    humanSlots: [1],
    picksBySlot: { 1: ["p1"] },
    autoPickMs: 30_000,
    varietySeed: "seed-a",
    startedBySessionId: "starter-session",
    players: [
      { id: "p1", name: "p1", position: "RB", team: "ATL", chenRank: 1 },
      { id: "p2", name: "p2", position: "WR", team: "BUF", chenRank: 2 },
      { id: "p3", name: "p3", position: "QB", team: "KC", chenRank: 3 },
      { id: "p4", name: "p4", position: "TE", team: "SF", chenRank: 4 },
    ],
    ...overrides,
  };
}

describe("demoResetAllowed", () => {
  it("lets only the starter reset an in-progress mock", () => {
    expect(
      demoResetAllowed({
        started: true,
        complete: false,
        startedBySessionId: "starter-session",
        callerSessionId: "starter-session",
      }),
    ).toBe(true);
    expect(
      demoResetAllowed({
        started: true,
        complete: false,
        startedBySessionId: "starter-session",
        callerSessionId: "other-session",
      }),
    ).toBe(false);
  });

  it("lets any seated caller reset after the mock finishes", () => {
    expect(
      demoResetAllowed({
        started: true,
        complete: true,
        startedBySessionId: "starter-session",
        callerSessionId: "other-session",
      }),
    ).toBe(true);
  });

  it("rejects a reset before kickoff or without a session", () => {
    expect(
      demoResetAllowed({
        started: false,
        complete: false,
        startedBySessionId: null,
        callerSessionId: "starter-session",
      }),
    ).toBe(false);
    expect(
      demoResetAllowed({
        started: true,
        complete: false,
        startedBySessionId: "starter-session",
        callerSessionId: "",
      }),
    ).toBe(false);
    expect(
      demoResetAllowed({
        started: true,
        complete: false,
        startedBySessionId: undefined,
        callerSessionId: "legacy-session",
      }),
    ).toBe(false);
  });
});

describe("demoBoardIsComplete", () => {
  it("treats a full pick board as finished", () => {
    expect(
      demoBoardIsComplete({
        picks: [{ overall: 1 }, { overall: 2 }, { overall: 3 }, { overall: 4 }] as never,
        players: [player("p1"), player("p2"), player("p3"), player("p4")],
        teamCount: 2,
        rounds: 2,
      }),
    ).toBe(true);
    expect(
      demoBoardIsComplete({
        picks: [{ overall: 1 }] as never,
        players: [player("p1"), player("p2"), player("p3"), player("p4")],
        teamCount: 2,
        rounds: 2,
      }),
    ).toBe(false);
  });
});

describe("buildResetDemoConfig", () => {
  it("clears the clock, picks, and starter so anyone can start the next round", () => {
    const next = buildResetDemoConfig(
      config(),
      {
        teamCount: 2,
        rounds: 2,
        players: [player("p1"), player("p2"), player("p3"), player("p4")],
      },
      [1, 2],
    );
    expect(next.startedAtIso).toBe("");
    expect(next.picksBySlot).toEqual({});
    expect(next.startedBySessionId).toBeUndefined();
    expect(next.humanSlots).toEqual([1, 2]);
    expect(next.varietySeed).toBeTruthy();
    expect(next.varietySeed).not.toBe("seed-a");
  });
});
