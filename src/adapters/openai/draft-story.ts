export const DRAFT_STORY_MODEL = "gpt-4o-mini";

export const DRAFT_STORY_SYSTEM =
  "You are a sharp fantasy recap writer for Draft Dojo. Write JSON only with keys story and share. story: one second-person paragraph, 80-110 words, witty but not mean, mentioning the grade plus one high and one low from the facts. share: one brag under 180 characters that names Draft Dojo. Use only supplied facts. Do not invent players, ranks, or scores. No bullets. No title. No markdown.";

export const DRAFT_INVITE_SYSTEM =
  "You write one punchy Draft Dojo invite line. JSON only: {\"line\":\"...\"}. Max 140 characters. Mention the host first name, team count, and scoring if given. Sound like a commissioner texting the group chat. No quotes. No hashtags. No URL.";

export interface DraftStoryCopy {
  readonly story: string;
  readonly share: string;
}

type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

function openaiKey(explicit?: string): string {
  const key = explicit ?? process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return key;
}

async function chatCompletion(
  system: string,
  user: string,
  options: {
    readonly fetch?: FetchLike;
    readonly apiKey?: string;
    readonly maxTokens?: number;
    readonly signal?: AbortSignal;
  } = {},
): Promise<string> {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey(options.apiKey)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DRAFT_STORY_MODEL,
      temperature: 0.7,
      max_tokens: options.maxTokens ?? 180,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: options.signal,
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `OpenAI ${response.status}`);
  }
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenAI returned an empty story");
  return content;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Model sometimes wraps JSON in prose; try to find the object.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    }
  }
  throw new Error("OpenAI returned invalid JSON");
}

export async function generateDraftStory(
  facts: string,
  options: { readonly fetch?: FetchLike; readonly apiKey?: string } = {},
): Promise<DraftStoryCopy> {
  const raw = await chatCompletion(DRAFT_STORY_SYSTEM, facts, {
    ...options,
    maxTokens: 180,
  });
  const parsed = parseJsonObject(raw);
  const story = typeof parsed.story === "string" ? parsed.story.trim() : "";
  const share = typeof parsed.share === "string" ? parsed.share.trim() : "";
  if (!story) throw new Error("OpenAI returned an empty story");
  return { story, share };
}

export async function generateInviteLine(
  input: {
    readonly host: string;
    readonly teamCount: number;
    readonly rounds: number;
    readonly scoring: string;
    readonly slot: number;
  },
  options: {
    readonly fetch?: FetchLike;
    readonly apiKey?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<string> {
  const raw = await chatCompletion(
    DRAFT_INVITE_SYSTEM,
    `Host: ${input.host}\nTeams: ${input.teamCount}\nRounds: ${input.rounds}\nScoring: ${input.scoring}\nHost slot: ${input.slot}`,
    { ...options, maxTokens: 60 },
  );
  const parsed = parseJsonObject(raw);
  const line = typeof parsed.line === "string" ? parsed.line.trim() : "";
  if (!line) throw new Error("OpenAI returned an empty invite line");
  return line.slice(0, 180);
}

export function openaiConfigured(explicit?: string): boolean {
  return Boolean(explicit ?? process.env.OPENAI_API_KEY?.trim());
}
