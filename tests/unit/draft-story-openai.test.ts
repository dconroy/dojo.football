import { describe, expect, it, vi } from "vitest";

import {
  DRAFT_STORY_MODEL,
  generateDraftStory,
  generateInviteLine,
  openaiConfigured,
} from "../../src/adapters/openai/draft-story";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("openai draft copy", () => {
  it("sends a capped gpt-4o-mini request and parses the story", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as {
        model: string;
        max_tokens: number;
        messages: Array<{ role: string }>;
      };
      expect(body.model).toBe(DRAFT_STORY_MODEL);
      expect(body.max_tokens).toBeLessThanOrEqual(180);
      expect(body.messages[0]?.role).toBe("system");
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                story: "You swung for the fences at slot 1.",
              }),
            },
          },
        ],
      });
    });

    const copy = await generateDraftStory("Grade: C+", {
      apiKey: "sk-test",
      fetch: fetchMock as never,
    });
    expect(copy.story).toMatch(/slot 1/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not call OpenAI when the key is missing", async () => {
    const fetchMock = vi.fn();
    await expect(
      generateDraftStory("Grade: B", { apiKey: "", fetch: fetchMock as never }),
    ).rejects.toThrow(/OPENAI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(openaiConfigured("")).toBe(false);
  });

  it("writes a short invite line from room facts", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                line: "Dave's 8-team half-PPR snake is live — grab a seat.",
              }),
            },
          },
        ],
      }),
    );
    const line = await generateInviteLine(
      {
        host: "dave",
        teamCount: 8,
        rounds: 15,
        scoring: "half-ppr",
        slot: 3,
      },
      { apiKey: "sk-test", fetch: fetchMock as never },
    );
    expect(line).toMatch(/8-team/);
  });
});
