import { describe, expect, it } from "vitest";
import {
  autoPickDeadline,
  autoPickIfDue,
  autoPickPlayerId,
  claimHumanSlot,
  isWaitingOnUser,
  mergeMockRankingSeeds,
  mockDraftResults,
  projectedDraftOrder,
  recordUserPick,
  rosterCompletionPick,
  slotForOverall,
  startMockClock,
  waitingSlot,
  type MockDraftConfig,
  type MockPlayerSeed,
} from "@/adapters/yahoo/mock-runner";

function seeds(count: number): MockPlayerSeed[] {
  const positions = ["RB", "WR", "QB", "TE", "K", "DEF"] as const;
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Player ${index + 1}`,
    position: positions[index % positions.length],
    team: "KC",
    chenRank: index + 1,
  }));
}

function config(overrides: Partial<MockDraftConfig> = {}): MockDraftConfig {
  return {
    leagueKey: "mock.test",
    teamCount: 12,
    rounds: 15,
    humanSlots: [5],
    intervalMs: 1000,
    startedAtIso: new Date(0).toISOString(),
    players: seeds(200),
    picksBySlot: {},
    ...overrides,
  };
}

describe("mock-runner", () => {
  it("stays paused until the clock is started", () => {
    const paused = config({ startedAtIso: "", humanSlots: [1] });
    expect(waitingSlot(paused)).toBeNull();
    expect(isWaitingOnUser(paused)).toBe(false);
    expect(mockDraftResults(paused).picks).toHaveLength(0);
    expect(autoPickDeadline(paused)).toBeNull();
    expect(() => recordUserPick(paused, "p1")).toThrow(/has not started/);

    const running = startMockClock(paused, 50_000);
    expect(Date.parse(running.startedAtIso)).toBe(50_000);
    expect(waitingSlot(running, 50_000)).toBe(1);
  });

  it("stops projecting when the ranked list is shorter than the draft", () => {
    const short = config({
      teamCount: 4,
      rounds: 10,
      humanSlots: [1],
      picksBySlot: { 1: ["p1", "p5", "p9"] },
      players: seeds(12),
    });
    const order = projectedDraftOrder(short);
    expect(order.length).toBeGreaterThan(3);
    expect(order.length).toBeLessThanOrEqual(12);
  });

  it("maps snake slots correctly", () => {
    expect(slotForOverall(1, 12)).toBe(1);
    expect(slotForOverall(5, 12)).toBe(5);
    expect(slotForOverall(12, 12)).toBe(12);
    expect(slotForOverall(13, 12)).toBe(12);
    expect(slotForOverall(17, 12)).toBe(8);
  });

  it("stops projecting at the user slot until a pick is recorded", () => {
    const base = config();
    const before = projectedDraftOrder(base);
    expect(before).toHaveLength(4);
    expect(isWaitingOnUser(base)).toBe(true);

    const after = recordUserPick(base, "p5", 10_000);
    expect(projectedDraftOrder(after).length).toBeGreaterThanOrEqual(5);
    expect(after.picksBySlot?.[5]).toEqual(["p5"]);
  });

  it("does not invent a user pick when the clock runs past the turn", () => {
    const base = config({ startedAtIso: new Date(0).toISOString() });
    const farFuture = 60_000;
    const { picks, waitingOnUser } = mockDraftResults(base, farFuture);
    expect(picks).toHaveLength(4);
    expect(waitingOnUser).toBe(true);
  });

  it("resumes opponent picks after confirm and clock rewind", () => {
    const base = config();
    const confirmed = recordUserPick(base, "p5", 20_000);
    const rightAfter = mockDraftResults(confirmed, 20_000);
    expect(rightAfter.picks).toHaveLength(5);
    expect(rightAfter.waitingOnUser).toBe(false);

    const nextTick = mockDraftResults(
      confirmed,
      20_000 + confirmed.intervalMs,
    );
    expect(nextTick.picks.length).toBeGreaterThanOrEqual(6);
  });

  it("treats a retried confirmation as idempotent", () => {
    const base = config();
    const confirmed = recordUserPick(base, "p5", 20_000, 5);
    expect(recordUserPick(confirmed, "p5", 20_000, 5)).toBe(confirmed);
  });

  it("normalizes the legacy single-seat shape", () => {
    const legacy = config({
      humanSlots: undefined,
      picksBySlot: undefined,
      userSlot: 3,
      userPicks: [],
    });
    // Robots take picks 1 and 2, then the draft blocks on slot 3.
    expect(projectedDraftOrder(legacy)).toHaveLength(2);
    expect(waitingSlot(legacy)).toBe(3);
  });

  it("pauses at every human seat and fills the rest with robots", () => {
    const base = config({ humanSlots: [1, 3], picksBySlot: {} });
    // Slot 1 is the very first pick, so the draft blocks immediately.
    expect(projectedDraftOrder(base)).toHaveLength(0);
    expect(waitingSlot(base, 10_000)).toBe(1);

    const afterOne = recordUserPick(base, "p1", 10_000, 1);
    expect(afterOne.picksBySlot?.[1]).toEqual(["p1"]);
    // The robot at slot 2 appears one interval after the confirm; only then is
    // slot 3 on the clock.
    expect(projectedDraftOrder(afterOne)).toHaveLength(2);
    expect(waitingSlot(afterOne, 10_000)).toBeNull();
    expect(waitingSlot(afterOne, 10_000 + base.intervalMs)).toBe(3);

    const afterTwo = recordUserPick(afterOne, "p6", 10_000 + base.intervalMs, 3);
    expect(afterTwo.picksBySlot?.[3]).toEqual(["p6"]);
    // Robots continue past slot 3 toward the next human seat.
    expect(projectedDraftOrder(afterTwo).length).toBeGreaterThanOrEqual(3);
  });

  it("never rewrites published robot picks when a later human pick is recorded", () => {
    const base = config({
      teamCount: 4,
      rounds: 2,
      humanSlots: [1, 3],
      picksBySlot: { 1: ["p1"], 3: ["p3"] },
    });
    const published = projectedDraftOrder(base);
    expect(published).toHaveLength(5);
    const conflictingPlayerId = published.at(-1)!.id;

    // This stale selection conflicts with the already-published robot pick at
    // overall 5. Replaying must stop at the conflict, never reserve that player
    // early and silently replace the historical robot pick with another player.
    const stale = {
      ...base,
      picksBySlot: { 1: ["p1"], 3: ["p3", conflictingPlayerId] },
    };
    expect(projectedDraftOrder(stale)).toEqual(published);
  });

  it("completes a 10-team, 15-round draft with four humans without changing history", () => {
    let draft = config({
      teamCount: 10,
      rounds: 15,
      humanSlots: [1, 2, 3, 4],
      picksBySlot: {},
      players: seeds(200),
      varietySeed: "four-human-production-regression",
    });
    let now = 1_000_000;

    for (let guard = 0; guard < 100; guard += 1) {
      const before = projectedDraftOrder(draft);
      if (before.length === draft.teamCount * draft.rounds) break;
      const slot = slotForOverall(before.length + 1, draft.teamCount);
      expect(draft.humanSlots).toContain(slot);
      const publishedIds = new Set(before.map((player) => player.id));
      const player = draft.players.find((candidate) => !publishedIds.has(candidate.id));
      expect(player).toBeDefined();

      now += 1_000_000;
      draft = recordUserPick(draft, player!.id, now, slot);
      expect(
        projectedDraftOrder(draft)
          .slice(0, before.length)
          .map((candidate) => candidate.id),
      ).toEqual(before.map((candidate) => candidate.id));
    }

    const completed = projectedDraftOrder(draft);
    expect(completed).toHaveLength(150);
    expect(new Set(completed.map((player) => player.id))).toHaveLength(150);
  });

  it("rejects a confirm from a slot that is not on the clock", () => {
    const base = config({ humanSlots: [1, 3], picksBySlot: {} });
    expect(() => recordUserPick(base, "p1", 10_000, 3)).toThrow(/slot 1/);
  });

  it("rejects confirming an already-drafted player", () => {
    const base = config({ humanSlots: [5], picksBySlot: {} });
    // p1 is the robots' first overall pick; slot 5 cannot re-draft it.
    expect(() => recordUserPick(base, "p1", 10_000)).toThrow(/already drafted/);
  });

  it("auto-drafts a human seat that blows the deadline", () => {
    const base = config({
      humanSlots: [1, 3],
      picksBySlot: {},
      autoPickMs: 30_000,
    });
    // Slot 1 is on the clock from t=0, so the deadline is exactly 30s later.
    expect(autoPickDeadline(base)).toBe(30_000);
    expect(autoPickPlayerId(base)).toBe("p1");
    expect(autoPickIfDue(base, 29_999)).toBeNull();

    const auto = autoPickIfDue(base, 30_000);
    expect(auto).not.toBeNull();
    expect(auto!.picksBySlot?.[1]).toEqual(["p1"]);
    expect(auto!.humanSlots).toEqual([1, 3]);
    // A robot fills slot 2, then the draft blocks on the next human (slot 3).
    expect(projectedDraftOrder(auto!)).toHaveLength(2);
    expect(waitingSlot(auto!, 30_000 + base.intervalMs)).toBe(3);
  });

  it("does not replay a player already taken by another seat", () => {
    const base = config({
      humanSlots: [1, 3],
      picksBySlot: { 1: ["p1"], 3: ["p1"] },
    });
    const order = projectedDraftOrder(base);
    const ids = order.map((player) => player.id);
    expect(ids).toContain("p1");
    expect(ids.filter((id) => id === "p1")).toHaveLength(1);
  });

  it("takes a kicker and defense in the last two rounds", () => {
    const skill = Array.from({ length: 40 }, (_, index) => ({
      id: `s${index + 1}`,
      name: `Skill ${index + 1}`,
      position: (["RB", "WR", "QB", "TE"] as const)[index % 4],
      team: "KC",
      chenRank: index + 1,
    }));
    const specialists: MockPlayerSeed[] = [
      ...[1, 2, 3].map((n) => ({
        id: `k${n}`,
        name: `Kicker ${n}`,
        position: "K" as const,
        team: "KC",
        chenRank: 200 + n,
      })),
      ...[1, 2, 3].map((n) => ({
        id: `d${n}`,
        name: `Defense ${n}`,
        position: "DEF" as const,
        team: "KC",
        chenRank: 210 + n,
      })),
    ];
    // Keep the pre-seeded human selections below the range robots reach in
    // this short draft. The projector consumes human picks chronologically;
    // future selections are not allowed to reserve players from earlier turns.
    const humanPicks = skill.slice(-6).map((player) => player.id);
    const base = config({
      teamCount: 4,
      rounds: 6,
      humanSlots: [1],
      picksBySlot: { 1: humanPicks },
      players: [...skill, ...specialists],
    });
    const order = projectedDraftOrder(base);
    expect(order).toHaveLength(24);
    for (const slot of [2, 3, 4]) {
      const roster = order.filter(
        (_, index) => slotForOverall(index + 1, 4) === slot,
      );
      expect(roster.some((player) => player.position === "K")).toBe(true);
      expect(roster.some((player) => player.position === "DEF")).toBe(true);
    }
  });

  it("applies stable, bounded variance to robot picks when seeded", () => {
    // Slot 13 never comes on the clock in a 12-team draft, so every pick is a
    // robot and we can inspect the full projected board.
    const allRobots = (varietySeed?: string) =>
      config({ humanSlots: [13], picksBySlot: {}, varietySeed });

    const bpa = projectedDraftOrder(allRobots()).map((player) => player.id);
    const varied = projectedDraftOrder(allRobots("seed-abc")).map((p) => p.id);

    // Same board size, no duplicates, every id is real.
    expect(varied).toHaveLength(bpa.length);
    expect(new Set(varied).size).toBe(varied.length);

    // Deterministic: recomputing the same seed yields the identical order, so the
    // projector never reshuffles between polls.
    expect(projectedDraftOrder(allRobots("seed-abc")).map((p) => p.id)).toEqual(
      varied,
    );

    // The nudge actually changes something versus strict best-available.
    expect(varied).not.toEqual(bpa);
  });

  it("gives different seats different preferences", () => {
    const seedA = projectedDraftOrder(
      config({ humanSlots: [13], picksBySlot: {}, varietySeed: "alpha" }),
    ).map((p) => p.id);
    const seedB = projectedDraftOrder(
      config({ humanSlots: [13], picksBySlot: {}, varietySeed: "beta" }),
    ).map((p) => p.id);
    expect(seedA).not.toEqual(seedB);
  });

  it("forces a starter hole shut once picks run tight", () => {
    // Lineup is one TE short; the flex is already covered by a third RB.
    const counts = { QB: 1, RB: 3, WR: 2, TE: 0, K: 1, DEF: 1 };
    const board: MockPlayerSeed[] = [
      { id: "rb", name: "RB", position: "RB", team: "KC", chenRank: 1 },
      { id: "te", name: "TE", position: "TE", team: "KC", chenRank: 90 },
    ];
    const available = () => true;

    // Two picks left is slack — draft best available, not a forced need.
    expect(rosterCompletionPick(board, available, counts, 2)).toBeUndefined();
    // One pick left must plug the TE hole even though an RB ranks far higher.
    expect(rosterCompletionPick(board, available, counts, 1)?.id).toBe("te");
  });

  it("auto-drafts an AFK seat into a complete starting lineup", () => {
    let cfg = config({
      teamCount: 4,
      rounds: 10,
      humanSlots: [1],
      picksBySlot: {},
      autoPickMs: 1,
    });
    // Nobody ever confirms for slot 1; drive the whole draft via auto-pick.
    const now = 1_000_000_000_000;
    for (let guard = 0; guard < 500; guard += 1) {
      const next = autoPickIfDue(cfg, now);
      if (!next) break;
      cfg = next;
    }

    expect(projectedDraftOrder(cfg)).toHaveLength(40);
    const byId = new Map(cfg.players.map((player) => [player.id, player]));
    const mine = cfg.picksBySlot?.[1] ?? [];
    expect(mine).toHaveLength(10);

    const counts = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
    for (const id of mine) counts[byId.get(id)!.position] += 1;

    expect(counts.QB).toBeGreaterThanOrEqual(1);
    expect(counts.RB).toBeGreaterThanOrEqual(2);
    expect(counts.WR).toBeGreaterThanOrEqual(2);
    expect(counts.TE).toBeGreaterThanOrEqual(1);
    expect(counts.K).toBeGreaterThanOrEqual(1);
    expect(counts.DEF).toBeGreaterThanOrEqual(1);
    // A RB/WR/TE beyond the minimums covers the FLEX.
    const flexSpare =
      Math.max(0, counts.RB - 2) +
      Math.max(0, counts.WR - 2) +
      Math.max(0, counts.TE - 1);
    expect(flexSpare).toBeGreaterThanOrEqual(1);
  });

  it("does not auto-draft when the feature is disabled", () => {
    const base = config({ humanSlots: [1], picksBySlot: {} });
    expect(autoPickDeadline(base)).toBeNull();
    expect(autoPickIfDue(base, 10_000_000)).toBeNull();
  });

  it("keeps a confirmed pick over a would-be auto-pick", () => {
    const base = config({
      humanSlots: [1, 3],
      picksBySlot: {},
      autoPickMs: 30_000,
    });
    // Human confirms before the deadline; nothing is auto-due afterward at t.
    const confirmed = recordUserPick(base, "p1", 5_000, 1);
    expect(confirmed.picksBySlot?.[1]).toEqual(["p1"]);
  });

  it("lets a new human inherit already-published robot picks for that seat", () => {
    const started = config({
      humanSlots: [1],
      startedAtIso: new Date(Date.now() - 60_000).toISOString(),
    });
    const afterFirst = recordUserPick(started, "p1", Date.now() - 50_000, 1);
    const claimed = claimHumanSlot(afterFirst, 3);
    expect(claimed.humanSlots).toEqual([1, 3]);
    expect(() => claimHumanSlot(claimed, 3)).toThrow(/already taken/);
  });

  it("updates ranks mid-draft without renaming already-drafted ids", () => {
    const current = [
      { id: "chen-1", name: "Stud", position: "RB" as const, team: "SF", chenRank: 2 },
      { id: "chen-2", name: "Bye", position: "WR" as const, team: "CHI", chenRank: 40 },
    ];
    const incoming = [
      { id: "fp-9", name: "Stud", position: "RB" as const, team: "SF", chenRank: 6, adp: 8 },
      { id: "fp-3", name: "Rookie", position: "WR" as const, team: "NYJ", chenRank: 12, adp: 15 },
    ];
    const merged = mergeMockRankingSeeds(current, incoming);
    expect(merged[0]).toMatchObject({ id: "chen-1", name: "Stud", chenRank: 6, adp: 8 });
    expect(merged.some((player) => player.id === "fp-3")).toBe(true);
    expect(merged.filter((player) => player.name === "Stud")).toHaveLength(1);
  });
});
