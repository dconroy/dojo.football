import { describe, expect, it } from "vitest";

import {
  authorizedBoardIdForUser,
  boardIdForUser,
  canManageBoard,
  requestedDraftId,
} from "@/auth/board-access";

const request = (query = "") => new Request(`https://dojo.test/api/draft${query}`);

describe("board access boundaries", () => {
  it("resolves each user to only their assigned board", () => {
    const sleeper = { boardId: null, sleeperDraftId: "draft-123" };
    const yahoo = { boardId: "yahoo:user-456", sleeperDraftId: null };

    expect(boardIdForUser(sleeper)).toBe("sleeper:draft-123");
    expect(boardIdForUser(yahoo)).toBe("yahoo:user-456");
    expect(authorizedBoardIdForUser(request(), sleeper)).toBe("sleeper:draft-123");
    expect(
      authorizedBoardIdForUser(request("?draftId=yahoo%3Auser-456"), yahoo),
    ).toBe("yahoo:user-456");
  });

  it("rejects an explicit board id owned by someone else", () => {
    expect(() =>
      authorizedBoardIdForUser(
        request("?draftId=sleeper%3Aother-draft"),
        { boardId: null, sleeperDraftId: "my-draft" },
      ),
    ).toThrow(/do not have access/i);
  });

  it("keeps demo ids visible for the seat-token access path", () => {
    expect(requestedDraftId(request("?draftId=demo%3Aroom-1"))).toBe(
      "demo:room-1",
    );
  });

  it("limits shared house-board management to admins", () => {
    expect(
      canManageBoard({ role: "member", boardId: null, sleeperDraftId: null }),
    ).toBe(false);
    expect(
      canManageBoard({ role: "admin", boardId: null, sleeperDraftId: null }),
    ).toBe(true);
    expect(
      canManageBoard({
        role: "member",
        boardId: null,
        sleeperDraftId: "owned-draft",
      }),
    ).toBe(true);
  });
});
