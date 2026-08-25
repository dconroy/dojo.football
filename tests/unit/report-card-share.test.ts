import { describe, expect, it } from "vitest";

import type { TeamReportCard } from "../../src/domain/draft-report";
import {
  buildReportCardShareModel,
  REPORT_CARD_IMAGE_HEIGHT,
  REPORT_CARD_IMAGE_WIDTH,
  reportCardFileName,
  wrapTextLines,
} from "../../src/domain/report-card-share";

const team = {
  slot: 3,
  rank: 2,
  grade: "A-",
  score: 0.81,
  avgChenRank: 31,
  eliteCount: 2,
  startersFilled: 8,
  positionCounts: { QB: 1, RB: 4, WR: 5, TE: 2, K: 1, DEF: 1 },
  holes: [],
  strengths: ["Elite core"],
  reasons: [
    { tone: "good", text: "  Strong running back value  " },
    { tone: "good", text: "Deep at wide receiver" },
    { tone: "neutral", text: "Balanced bye weeks" },
    { tone: "bad", text: "Late quarterback" },
  ],
  steal: null,
  reach: null,
  byeAlert: null,
  summary: "  An elite core with enough depth to contend.  ",
  picks: Array.from({ length: 7 }, (_, index) => ({
    overall: index + 1,
    round: index + 1,
    slot: 3,
    rosterSlot: "RB" as const,
    player: {
      id: `player-${index}`,
      name: `Player ${index + 1}`,
      position: "RB" as const,
      team: "KC",
    },
  })),
} satisfies TeamReportCard;

describe("report-card sharing", () => {
  it("builds a bounded image model from report data", () => {
    const model = buildReportCardShareModel(team, "  Sunday Heroes ", 12);

    expect(REPORT_CARD_IMAGE_WIDTH).toBe(1200);
    expect(REPORT_CARD_IMAGE_HEIGHT).toBe(630);
    expect(model.teamName).toBe("Sunday Heroes");
    expect(model.rankLabel).toBe("2nd of 12");
    expect(model.summary).toBe("An elite core with enough depth to contend.");
    expect(model.reasons).toHaveLength(3);
    expect(model.reasons[0]).toBe("Strong running back value");
    expect(model.picks).toHaveLength(5);
    expect(model.picks[0]).toEqual({
      round: "R1",
      name: "Player 1",
      position: "RB",
    });
    expect(model.url).toBe("DOJO.FOOTBALL");
  });

  it("includes the draft story in the image model", () => {
    const model = buildReportCardShareModel(
      team,
      "Sunday Heroes",
      12,
      "A patient draft turned into a balanced contender.",
    );

    expect(model.story).toBe("A patient draft turned into a balanced contender.");
  });

  it("creates safe filenames and truncates wrapped image copy", () => {
    expect(reportCardFileName(" Déjà Vu & Friends! ")).toBe(
      "draft-dojo-deja-vu-friends.png",
    );
    expect(reportCardFileName("🔥")).toBe("draft-dojo-report-card.png");
    expect(wrapTextLines("one two three four", 7, (value) => value.length, 2))
      .toEqual(["one two", "three…"]);
    expect(wrapTextLines("championship", 6, (value) => value.length))
      .toEqual(["champ…"]);
  });
});
