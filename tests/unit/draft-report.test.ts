import { describe, expect, it } from "vitest";

import {
  buildDraftReport,
  letterGrade,
  limitIncompleteGrade,
} from "../../src/domain/draft-report";
import {
  cachedDraftStory,
  formatDraftStoryFacts,
  packDraftStoryFacts,
  parseDraftStories,
  withDraftStory,
} from "../../src/domain/draft-story";
import type { DraftState, Pick, Player, Position } from "../../src/domain";

function player(
  name: string,
  position: Position,
  chenRank: number,
  overrides: Partial<Player> = {},
): Player {
  return {
    id: name,
    name,
    position,
    team: "KC",
    chenRank,
    ...overrides,
  };
}

function pick(
  overall: number,
  drafted: Player,
  rosterSlot: Pick["rosterSlot"] = drafted.position,
): Pick {
  return {
    overall,
    round: Math.ceil(overall / 12),
    slot: 1,
    player: drafted,
    rosterSlot,
  };
}

describe("draft report card", () => {
  it("maps composite scores onto letter grades", () => {
    expect(letterGrade(0.95)).toBe("A+");
    expect(letterGrade(0.9)).toBe("A");
    expect(letterGrade(0.67)).toBe("B");
    expect(letterGrade(0.05)).toBe("F");
  });

  it("flags steals, reaches, and starter holes", () => {
    const draft: DraftState = {
      teamCount: 12,
      rounds: 15,
      userSlot: 1,
      picks: [
        pick(1, player("ReachWR", "WR", 80)),
        pick(24, player("Stud", "RB", 3)),
        pick(25, player("QB One", "QB", 25)),
        pick(48, player("WR Two", "WR", 40)),
        pick(49, player("TE One", "TE", 50)),
        pick(72, player("Kick", "K", 140)),
      ],
    };

    const report = buildDraftReport(draft);
    expect(report.complete).toBe(false);
    const slot1 = report.teams.find((team) => team.slot === 1);
    expect(slot1?.steal?.name).toBe("Stud");
    expect(slot1?.reach?.name).toBe("ReachWR");
    expect(slot1?.holes).toContain("No DEF");
    expect(slot1?.holes).toContain("1/2 RB");
  });

  it("does not call required kicker or defense picks reaches", () => {
    const draft: DraftState = {
      teamCount: 12,
      rounds: 15,
      userSlot: 1,
      picks: [
        pick(110, player("Zane Gonzalez", "K", 977)),
        pick(134, player("Chiefs", "DEF", 250)),
      ],
    };
    const slot1 = buildDraftReport(draft).teams.find((team) => team.slot === 1);
    expect(slot1?.reach).toBeNull();
  });

  it("does not call a pick a reach when market ADP supports it", () => {
    const draft: DraftState = {
      teamCount: 12,
      rounds: 15,
      userSlot: 5,
      picks: [
        {
          ...pick(
            140,
            player("Theo Wease Jr.", "WR", 189, { adp: 127.4 }),
            "BENCH",
          ),
          slot: 5,
        },
      ],
    };
    const slot5 = buildDraftReport(draft).teams.find((team) => team.slot === 5);
    expect(slot5?.reach).toBeNull();
  });

  it("labels value against consensus when board rank and ADP agree", () => {
    const draft: DraftState = {
      teamCount: 12,
      rounds: 15,
      userSlot: 1,
      picks: [
        pick(1, player("True Reach", "WR", 80, { adp: 70 })),
      ],
    };
    const slot1 = buildDraftReport(draft).teams.find((team) => team.slot === 1);
    expect(slot1?.reach?.detail).toMatch(/consensus rank 75 at 1 \(-74\)/);
  });

  it("caps an incomplete grade at B+ even when talent would otherwise be A-range", () => {
    expect(limitIncompleteGrade("A-", 1)).toBe("B+");
    expect(limitIncompleteGrade("A+", 2)).toBe("B+");
    expect(limitIncompleteGrade("B", 1)).toBe("B");
    expect(limitIncompleteGrade("A", 0)).toBe("A");

    const eliteCore = [
      pick(1, player("CMC", "RB", 1)),
      pick(24, player("Chase", "WR", 2)),
      pick(25, player("Bijan", "RB", 4)),
      pick(48, player("JJ", "WR", 6)),
      pick(49, player("Allen", "QB", 15)),
      pick(72, player("Kelce", "TE", 20)),
      pick(73, player("Kyren", "RB", 22)),
      pick(96, player("Amon", "WR", 28)),
      pick(97, player("Puka", "WR", 32)),
      pick(120, player("Gibbs", "RB", 10)),
      pick(144, player("Ravens", "DEF", 180)),
    ];
    const incomplete: DraftState = {
      teamCount: 12,
      rounds: 15,
      userSlot: 1,
      picks: [...eliteCore, pick(121, player("Dart", "WR", 45))],
    };
    const complete: DraftState = {
      teamCount: 12,
      rounds: 15,
      userSlot: 1,
      picks: [...eliteCore, pick(121, player("Aubrey", "K", 201))],
    };

    const incompleteTeam = buildDraftReport(incomplete).teams.find(
      (team) => team.slot === 1,
    );
    const completeTeam = buildDraftReport(complete).teams.find(
      (team) => team.slot === 1,
    );
    expect(incompleteTeam?.holes).toContain("No K");
    expect(["A+", "A", "A-"]).not.toContain(incompleteTeam?.grade);
    expect(["A+", "A", "A-"]).toContain(completeTeam?.grade);
  });

  it("packs a compact fact sheet from the already-graded card", () => {
    const draft: DraftState = {
      teamCount: 8,
      rounds: 12,
      userSlot: 1,
      picks: [
        pick(1, player("ReachWR", "WR", 80)),
        pick(16, player("Stud", "RB", 3)),
        pick(17, player("QB One", "QB", 25)),
        pick(32, player("WR Two", "WR", 40)),
        pick(33, player("TE One", "TE", 50)),
        pick(48, player("Kick", "K", 140)),
      ],
    };
    const team = buildDraftReport(draft).teams.find((entry) => entry.slot === 1);
    expect(team).toBeTruthy();
    const facts = packDraftStoryFacts(team!, "dave", 8);
    expect(facts.teamName).toBe("dave");
    expect(facts.grade).toBe(team!.grade);
    expect(facts.rank).toBe(team!.rank);
    expect(facts.field).toBe(8);
    expect(facts.reasons.length).toBeGreaterThan(0);
    expect(facts.reasons.length).toBeLessThanOrEqual(6);
    expect(facts.picks.some((line) => line.includes("Stud (RB)"))).toBe(true);
    const blob = formatDraftStoryFacts(facts);
    expect(blob).toContain("Grade:");
    expect(blob).toContain(team!.grade);
    expect(blob.split("\n").length).toBeLessThanOrEqual(12);
  });

  it("returns a cached story only when the pick count still matches", () => {
    const stored = withDraftStory({}, 4, 112, "You went stars and scrubs.", "C+ in an 8-team snake.");
    expect(cachedDraftStory(stored, 4, 112)?.text).toMatch(/stars and scrubs/);
    expect(cachedDraftStory(stored, 4, 112)?.share).toMatch(/C\+/);
    expect(cachedDraftStory(stored, 4, 96)).toBeNull();
    expect(cachedDraftStory(parseDraftStories("not-json"), 4, 112)).toBeNull();
  });
});
