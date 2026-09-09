import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const MODEL = process.env.RECAP_MODEL?.trim() || "gpt-4o";

interface Reason {
  readonly tone: "good" | "bad" | "neutral";
  readonly text: string;
}

interface RosterPick {
  readonly overall: number;
  readonly round: number;
  readonly slot: number;
  readonly name: string;
  readonly position: string;
  readonly team: string;
  readonly chenRank: number | null;
  readonly chenTier: number | null;
}

interface GradedTeam {
  readonly slot: number;
  readonly rank: number;
  readonly grade: string;
  readonly score: number;
  readonly avgChenRank: number | null;
  readonly eliteCount: number;
  readonly startersFilled: number;
  readonly positionCounts: Record<string, number>;
  readonly holes: readonly string[];
  readonly strengths: readonly string[];
  readonly reasons: readonly Reason[];
  readonly steal: { readonly name: string; readonly detail: string } | null;
  readonly reach: { readonly name: string; readonly detail: string } | null;
  readonly byeAlert: string | null;
  readonly summary: string;
  readonly teamName: string;
  readonly roster: readonly RosterPick[];
}

interface GradedPayload {
  readonly league: string;
  readonly scoring: string;
  readonly source: string;
  readonly teamCount: number;
  readonly rounds: number;
  readonly totalPicks: number;
  readonly teams: readonly GradedTeam[];
}

interface TeamCopy {
  readonly teamName: string;
  readonly headline: string;
  readonly story: string;
}

interface RecapCopy {
  readonly leagueHeadline: string;
  readonly leagueDek: string;
  readonly teams: readonly TeamCopy[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function gradeLetter(grade: string): string {
  return grade[0] ?? "C";
}

async function generateCopy(payload: GradedPayload): Promise<RecapCopy> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not set");

  const facts = payload.teams.map((team) => ({
    teamName: team.teamName,
    slot: team.slot,
    grade: team.grade,
    rank: team.rank,
    field: payload.teamCount,
    summary: team.summary,
    reasons: team.reasons.map((reason) => reason.text),
    steal: team.steal?.detail ?? null,
    reach: team.reach?.detail ?? null,
    picks: team.roster.map(
      (pick) =>
        `R${pick.round} ${pick.name} (${pick.position}${
          pick.chenRank ? ` Chen ${pick.chenRank}` : ""
        })`,
    ),
  }));

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.75,
      max_tokens: 3500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are Draft Dojo's recap desk. Write JSON only. Voice: sharp commissioner texting the group chat. Witty, specific, not mean, no slurs. Use only supplied facts. Do not invent players, ranks, or scores. leagueHeadline: 8-14 words, punchy, no quotes, no hashtags. leagueDek: one sentence, max 160 characters. teams: array matching every teamName exactly, each with headline (max 72 characters, third person, no quotes) and story (80-110 words, third person, mention the letter grade plus one high and one low). No markdown.",
        },
        {
          role: "user",
          content: [
            "League: Full Contact Fantasy Football",
            "Format: 12-team snake, 15 rounds, 0.5 PPR",
            "Grader: Boris Chen 0.5 PPR tiers — Yahoo's letter grades are ignored",
            "Draft: September 8, 2026",
            JSON.stringify({ teams: facts }),
          ].join("\n"),
        },
      ],
    }),
  });
  const body = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `OpenAI ${response.status}`);
  }
  const raw = body.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("OpenAI returned empty copy");
  const parsed = JSON.parse(raw) as RecapCopy;
  if (!parsed.leagueHeadline || !parsed.teams?.length) {
    throw new Error("OpenAI JSON missing headline or teams");
  }
  return parsed;
}

function renderHtml(payload: GradedPayload, copy: RecapCopy): string {
  const copyByName = new Map(copy.teams.map((row) => [row.teamName, row]));
  const teams = payload.teams.map((team) => {
    const row = copyByName.get(team.teamName);
    return {
      ...team,
      headline: row?.headline ?? team.summary,
      story: row?.story ?? team.reasons.map((reason) => reason.text).join(" "),
    };
  });

  const board = teams
    .map((team) => {
      const letter = gradeLetter(team.grade);
      const counts = ["QB", "RB", "WR", "TE", "K", "DEF"]
        .map((position) => {
          const count = team.positionCounts[position] ?? 0;
          return `<i class="${count === 0 ? "zero" : ""}">${count}${position}</i>`;
        })
        .join("");
      const reasons = team.reasons
        .map(
          (reason) =>
            `<li class="tone-${reason.tone}">${escapeHtml(reason.text)}</li>`,
        )
        .join("");
      const roster = team.roster
        .map((pick) => {
          const meta = [
            pick.position,
            pick.chenRank ? `Chen ${pick.chenRank}` : "off Chen board",
            pick.chenTier ? `T${pick.chenTier}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return `<li><em>${pick.round}.${String(pick.slot).padStart(2, "0")}</em><b>${escapeHtml(pick.name)}</b><small>${escapeHtml(meta)}</small></li>`;
        })
        .join("");
      const mine = team.teamName === "Cobra Kai" ? " mine" : "";
      return `
<article class="card grade-${letter}${mine}" id="slot-${team.slot}">
  <button type="button" class="card-head" aria-expanded="${team.rank === 1 ? "true" : "false"}">
    <span class="rank">${team.rank}</span>
    <span class="grade">${escapeHtml(team.grade)}</span>
    <span class="copy">
      <b>${escapeHtml(team.teamName)}${mine ? " <em>house</em>" : ""}</b>
      <small>${escapeHtml(team.headline)}</small>
    </span>
    <span class="pos">${counts}</span>
    <span class="chevron" aria-hidden="true">▾</span>
  </button>
  <div class="card-body"${team.rank === 1 ? "" : " hidden"}>
    <p class="story">${escapeHtml(team.story)}</p>
    <ul class="reasons">${reasons}</ul>
    <ol class="roster">${roster}</ol>
  </div>
</article>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Full Contact 2026 · Chen 0.5 PPR report card · Draft Dojo</title>
  <meta name="description" content="${escapeHtml(copy.leagueDek)}" />
  <meta property="og:title" content="${escapeHtml(copy.leagueHeadline)}" />
  <meta property="og:description" content="${escapeHtml(copy.leagueDek)}" />
  <meta property="og:url" content="https://dojo.football/recap" />
  <link rel="icon" href="/brand-icon.svg" type="image/svg+xml" />
  <style>
    :root {
      --ink: #0a120d;
      --field: #0f2d1d;
      --field-bright: #174a2d;
      --cream: #f2ead0;
      --paper: #d9d2b9;
      --orange: #ef702f;
      --lime: #b8e986;
      --muted: #9fb4a6;
      --line: rgb(242 234 208 / 16%);
      --panel: #102418;
      --grade-a: #7ee08a;
      --grade-b: #7ec8f0;
      --grade-c: #e3b15a;
      --grade-d: #e07a4a;
      --grade-f: #e05a55;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: var(--ink); color: var(--cream); }
    body {
      min-height: 100vh;
      font-family: Arial, Helvetica, sans-serif;
      background-image:
        linear-gradient(rgb(242 234 208 / 3%) 1px, transparent 1px),
        linear-gradient(90deg, rgb(242 234 208 / 3%) 1px, transparent 1px);
      background-size: 64px 64px;
    }
    a { color: inherit; }
    .bar {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 16px;
      min-height: 32px;
      padding: 0 clamp(16px, 4vw, 64px);
      background: var(--orange);
      color: #170b07;
      font-size: 10px;
      font-weight: 850;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .bar span:last-child { text-align: right; }
    .wrap { width: min(980px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 80px; }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 22px;
      text-decoration: none;
    }
    .brand img {
      width: 42px;
      height: 42px;
      border: 1px solid #52715f;
      border-radius: 9px;
    }
    .brand strong { display: block; font-size: 15px; letter-spacing: .08em; }
    .brand small { color: var(--muted); font-size: 10px; letter-spacing: .14em; }
    .hero h1 {
      margin: 0 0 12px;
      max-width: 18ch;
      font-size: clamp(34px, 7vw, 64px);
      line-height: .92;
      letter-spacing: -.04em;
    }
    .dek {
      margin: 0 0 22px;
      max-width: 62ch;
      color: var(--paper);
      font-size: 16px;
      line-height: 1.5;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 28px;
      padding: 0;
      list-style: none;
    }
    .meta li {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgb(15 45 29 / 72%);
      padding: 6px 11px;
      color: var(--paper);
      font-size: 11px;
      font-weight: 750;
      letter-spacing: .04em;
    }
    .note {
      margin: 0 0 26px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .board { display: grid; gap: 8px; }
    .card {
      border: 1px solid var(--line);
      border-left: 4px solid var(--grade);
      border-radius: 12px;
      background: var(--panel);
      overflow: hidden;
    }
    .grade-A { --grade: var(--grade-a); }
    .grade-B { --grade: var(--grade-b); }
    .grade-C { --grade: var(--grade-c); }
    .grade-D { --grade: var(--grade-d); }
    .grade-F { --grade: var(--grade-f); }
    .card.mine { box-shadow: inset 0 0 0 1px rgb(184 233 134 / 28%); }
    .card-head {
      display: grid;
      grid-template-columns: 28px 42px minmax(0, 1fr) auto 16px;
      align-items: center;
      gap: 12px;
      width: 100%;
      border: 0;
      background: transparent;
      color: inherit;
      padding: 12px 14px;
      text-align: left;
      cursor: pointer;
    }
    .rank { color: var(--muted); font-size: 12px; font-weight: 700; text-align: center; }
    .grade {
      color: var(--grade);
      font-size: 24px;
      font-weight: 850;
      letter-spacing: -.03em;
      text-align: center;
    }
    .copy { min-width: 0; display: grid; gap: 2px; }
    .copy b { font-size: 14px; }
    .copy em {
      margin-left: 6px;
      color: var(--lime);
      font-style: normal;
      font-size: 10px;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .copy small {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }
    .pos { display: flex; gap: 4px; }
    .pos i {
      border: 1px solid var(--line);
      border-radius: 5px;
      background: rgb(10 18 13 / 45%);
      padding: 2px 5px;
      font-size: 10px;
      font-style: normal;
      font-weight: 750;
    }
    .pos i.zero { opacity: .35; }
    .chevron { color: var(--muted); font-size: 12px; }
    .card-body {
      display: grid;
      gap: 14px;
      border-top: 1px solid var(--line);
      padding: 14px;
    }
    .story { margin: 0; color: var(--paper); font-size: 14px; line-height: 1.55; }
    .reasons, .roster { margin: 0; padding: 0; list-style: none; }
    .reasons { display: grid; gap: 6px; }
    .reasons li { position: relative; padding-left: 16px; font-size: 12px; line-height: 1.45; }
    .reasons li::before { position: absolute; left: 0; font-weight: 800; }
    .tone-good::before { content: "+"; color: var(--lime); }
    .tone-bad::before { content: "−"; color: #e07a4a; }
    .tone-neutral::before { content: "·"; color: var(--muted); }
    .tone-neutral { color: var(--muted); }
    .roster {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 16px;
    }
    .roster li {
      display: grid;
      grid-template-columns: 36px 1fr;
      gap: 6px 8px;
      align-items: baseline;
      font-size: 12px;
    }
    .roster em { color: var(--muted); font-style: normal; font-size: 10px; font-weight: 700; }
    .roster small { grid-column: 2; color: var(--muted); font-size: 10px; }
    footer {
      margin-top: 36px;
      padding-top: 18px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    footer a { color: var(--lime); }
    @media (max-width: 720px) {
      .bar { grid-template-columns: 1fr; padding: 8px 16px; gap: 4px; }
      .bar span:last-child { text-align: left; }
      .card-head { grid-template-columns: 22px 36px minmax(0, 1fr) 14px; }
      .pos { display: none; }
      .roster { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="bar">
    <span>Draft Dojo</span>
    <span>Chen 0.5 PPR · not Yahoo</span>
    <span>Sep 8, 2026</span>
  </div>
  <main class="wrap">
    <a class="brand" href="https://dojo.football">
      <img src="/brand-icon.svg" alt="" />
      <span>
        <strong>DRAFT DOJO</strong>
        <small>POST-DRAFT REPORT CARD</small>
      </span>
    </a>
    <section class="hero">
      <h1>${escapeHtml(copy.leagueHeadline)}</h1>
      <p class="dek">${escapeHtml(copy.leagueDek)}</p>
      <ul class="meta">
        <li>Full Contact Fantasy Football</li>
        <li>12 teams · 15 rounds</li>
        <li>Boris Chen 0.5 PPR</li>
        <li>180 picks graded</li>
      </ul>
      <p class="note">Yahoo's own grades are ADP cosplay. These letters curve the room against Chen's half-PPR board: core talent, pick value, and whether every starter got filled. Expand a row for the story and the roster.</p>
    </section>
    <section class="board" aria-label="Team grades">
      ${board}
    </section>
    <footer>
      Graded ${payload.teamCount} complete rosters against ${escapeHtml(payload.source)}.
      Late kickers and defenses off Chen's published list do not move the curve.
      Built to share · <a href="https://dojo.football">dojo.football</a>
    </footer>
  </main>
  <script>
    document.querySelectorAll(".card-head").forEach(function (button) {
      button.addEventListener("click", function () {
        var body = button.nextElementSibling;
        var open = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", open ? "false" : "true");
        if (body) body.hidden = open;
      });
    });
  </script>
</body>
</html>
`;
}

async function main() {
  const payload = JSON.parse(
    readFileSync(resolve(ROOT, "results/graded.json"), "utf8"),
  ) as GradedPayload;
  const fromCopy = process.argv.includes("--from-copy");
  const copy = fromCopy
    ? (JSON.parse(
        readFileSync(resolve(ROOT, "results/recap-copy.json"), "utf8"),
      ) as RecapCopy)
    : await generateCopy(payload);
  if (!fromCopy) {
    writeFileSync(
      resolve(ROOT, "results/recap-copy.json"),
      JSON.stringify(copy, null, 2),
    );
  }
  const html = renderHtml(payload, copy);
  writeFileSync(resolve(ROOT, "public/recap.html"), html);
  writeFileSync(resolve(ROOT, "results/recap.html"), html);
  console.log(
    JSON.stringify(
      {
        model: MODEL,
        headline: copy.leagueHeadline,
        dek: copy.leagueDek,
        teams: copy.teams.map((team) => ({
          team: team.teamName,
          headline: team.headline,
          words: team.story.trim().split(/\s+/).length,
        })),
        out: ["public/recap.html", "results/recap.html"],
      },
      null,
      2,
    ),
  );
}

void main();
