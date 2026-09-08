import { describe, expect, it } from "vitest";

import type { Player } from "../../src/domain";
import {
  applyScribePaste,
  createDraftState,
  makeManualPick,
  parseYahooDraftText,
  playersFromChenImport,
  resolveYahooPaste,
  resolveYahooPick,
  selectionForOverall,
  suggestPlayers,
} from "../../src/domain";

const players: readonly Player[] = [
  {
    id: "chase",
    name: "Ja'Marr Chase",
    position: "WR",
    team: "CIN",
    chenRank: 1,
    chenTier: 1,
  },
  {
    id: "bijan",
    name: "Bijan Robinson",
    position: "RB",
    team: "ATL",
    chenRank: 2,
    chenTier: 1,
  },
  {
    id: "aj-brown",
    name: "A.J. Brown",
    position: "WR",
    team: "PHI",
    chenRank: 8,
    aliases: ["AJ Brown"],
  },
  {
    id: "sf-def",
    name: "San Francisco 49ers",
    position: "DEF",
    team: "SF",
    chenRank: 140,
  },
  {
    id: "gabe-buf",
    name: "Gabriel Davis",
    position: "WR",
    team: "BUF",
    aliases: ["Gabe Davis"],
    chenRank: 90,
  },
  {
    id: "gabe-jax",
    name: "Gabe Davis",
    position: "WR",
    team: "JAX",
    chenRank: 110,
  },
];

describe("parseYahooDraftText", () => {
  it("reads numbered Yahoo lines with position and team", () => {
    expect(
      parseYahooDraftText(`
        Round 1
        1. Ja'Marr Chase (WR - CIN)
        2. Bijan Robinson (RB - ATL)
      `),
    ).toEqual([
      { raw: "1. Ja'Marr Chase (WR - CIN)", name: "Ja'Marr Chase", team: "CIN", position: "WR" },
      { raw: "2. Bijan Robinson (RB - ATL)", name: "Bijan Robinson", team: "ATL", position: "RB" },
    ]);
  });

  it("reads pick codes, fantasy team prefixes, and swapped paren teams", () => {
    expect(
      parseYahooDraftText(`
        1.06 Thunderducks Ja'Marr Chase WR CIN
        Round 1, Pick 2: Bijan Robinson (ATL - RB)
        A.J. Brown Jr., WR - PHI
      `),
    ).toMatchObject([
      { name: "Thunderducks Ja'Marr Chase", team: "CIN", position: "WR" },
      { name: "Bijan Robinson", team: "ATL", position: "RB" },
      { name: "A.J. Brown Jr.", team: "PHI", position: "WR" },
    ]);
  });

  it("reads tab-separated recap rows and defenses", () => {
    expect(
      parseYahooDraftText("1\tJa'Marr Chase\tWR\tCin\nPick 2: 49ers D/ST"),
    ).toMatchObject([
      { name: "Ja'Marr Chase", position: "WR", team: "Cin" },
      { name: "49ers D/ST" },
    ]);
  });
});

describe("resolveYahooPick", () => {
  it("strips a fantasy team prefix and matches Chen names", () => {
    const hit = resolveYahooPick(
      { raw: "1.06 Thunderducks Ja'Marr Chase WR CIN", name: "Thunderducks Ja'Marr Chase", team: "CIN" },
      players,
    );
    expect(hit).toMatchObject({ status: "resolved", player: { id: "chase" } });
    expect(resolveYahooPick({ raw: "49ers", name: "49ers D/ST" }, players)).toMatchObject({
      status: "resolved",
      player: { id: "sf-def" },
    });
    expect(resolveYahooPick({ raw: "AJ", name: "A.J. Brown Jr.", team: "PHI" }, players)).toMatchObject({
      status: "resolved",
      player: { id: "aj-brown" },
    });
  });

  it("does not guess when two players share a name", () => {
    expect(resolveYahooPick({ raw: "Gabe", name: "Gabe Davis" }, players)).toMatchObject({
      status: "ambiguous",
    });
    expect(
      resolveYahooPick({ raw: "Gabe BUF", name: "Gabe Davis", team: "BUF" }, players),
    ).toMatchObject({ status: "resolved", player: { id: "gabe-buf" } });
  });
});

describe("resolveYahooPaste", () => {
  it("applies a messy recap in order and stops on the first unresolved line", () => {
    const result = resolveYahooPaste(
      `1. Ja'Marr Chase (WR - CIN)
       2. Bijan Robinson (RB - ATL)
       3. Mystery Man (WR - FA)
       4. A.J. Brown (WR - PHI)`,
      players,
    );
    expect(result.resolved.map((player) => player.id)).toEqual(["chase", "bijan"]);
    expect(result.pending?.parsed.name).toBe("Mystery Man");
    expect(result.pending?.resolution.status).toBe("notFound");
  });
});

describe("scribe snake math", () => {
  it("puts slot 6 on the clock at overall 6 after five recorded picks", () => {
    const names = ["chase", "bijan", "aj-brown", "gabe-buf", "gabe-jax"];
    let draft = createDraftState(6, { teamCount: 12, rounds: 15 });
    for (const id of names) {
      const player = players.find((candidate) => candidate.id === id);
      if (!player) throw new Error(id);
      draft = makeManualPick(draft, player);
    }
    const current = selectionForOverall(draft.picks.length + 1, draft.teamCount);
    expect(current).toEqual({ overall: 6, round: 1, slot: 6 });
    const later = applyScribePaste(draft, [players.find((player) => player.id === "sf-def")!]);
    expect(later.picks.at(-1)?.player.id).toBe("sf-def");
    expect(later.picks).toHaveLength(6);
  });
});

describe("playersFromChenImport", () => {
  it("maps Chen ranks and skips unknown positions", () => {
    const pool = playersFromChenImport({
      players: [
        {
          sourceId: "chase",
          name: "Ja'Marr Chase",
          position: "WR",
          team: "CIN",
          overallRank: 1,
          tier: 1,
          byeWeek: 10,
          adp: 1.2,
        },
        {
          sourceId: "bad",
          name: "Coach",
          position: "HC",
        },
      ],
    });
    expect(pool).toEqual([
      {
        id: "chase",
        name: "Ja'Marr Chase",
        position: "WR",
        team: "CIN",
        chenRank: 1,
        chenTier: 1,
        byeWeek: 10,
        adp: 1.2,
      },
    ]);
  });
});

describe("suggestPlayers", () => {
  it("ranks Chen matches by overall rank", () => {
    expect(suggestPlayers("da", players).map((player) => player.id)).toEqual([
      "gabe-buf",
      "gabe-jax",
    ]);
  });
});
