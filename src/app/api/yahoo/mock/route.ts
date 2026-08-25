import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDemoClaims } from "@/auth/demo-session";
import { getCurrentUser } from "@/auth/current-user";
import { prisma } from "@/persistence/prisma";
import { validateDemoSeat } from "@/persistence/demo-rooms";
import {
  advanceMockAutoPicks,
  appendMockUserPick,
  checkpointId,
  loadMockConfig,
  saveMockConfig,
} from "@/adapters/yahoo/mock-store";
import { shortBoardMessage } from "@/domain/draft-capacity";
import type { MockPlayerSeed } from "@/adapters/yahoo/mock-runner";
import type { MockDraftConfig } from "@/adapters/yahoo/mock-runner";
import {
  autoPickDeadline,
  elapsedPickCount,
  projectedDraftOrder,
  waitingSlot,
} from "@/adapters/yahoo/mock-runner";

const DEFAULT_AUTO_PICK_MS = 20000;

export const runtime = "nodejs";

const ALLOWED_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        action?: "start" | "confirm";
        leagueKey?: string;
        playerId?: string;
        slot?: number;
        userSlot?: number;
        humanSlots?: number[];
        teamCount?: number;
        rounds?: number;
        intervalMs?: number;
        autoPickMs?: number;
        players?: Array<Partial<MockPlayerSeed> & { position?: string }>;
      }
    | null;

  const leagueKey = body?.leagueKey?.trim();
  if (!body || !leagueKey || !leagueKey.startsWith("mock.")) {
    return NextResponse.json(
      { error: "leagueKey must start with 'mock.'" },
      { status: 400 },
    );
  }

  const demoMock = leagueKey.startsWith("mock.demo.");
  let actorSlot = body.slot;
  if (demoMock) {
    const demo = await getDemoClaims(request);
    const expectedLeagueKey = demo
      ? `mock.${demo.roomId.replace(/:/g, ".")}`
      : null;
    if (
      !demo ||
      demo.role !== "play" ||
      !demo.slot ||
      expectedLeagueKey !== leagueKey ||
      !(await validateDemoSeat(demo.roomId, demo.slot, demo.sessionId))
    ) {
      return NextResponse.json(
        { error: "Choose the matching demo seat before confirming a pick" },
        { status: 403 },
      );
    }
    actorSlot = demo.slot;
  } else {
    const user = await getCurrentUser();
    if (!user || user.status !== "active") {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    if (body.action === "confirm") actorSlot = user.draftSlot ?? undefined;
  }

  if (body.action === "confirm") {
    if (!body.playerId) {
      return NextResponse.json({ error: "playerId required" }, { status: 400 });
    }
    try {
      const config = await appendMockUserPick(
        leagueKey,
        body.playerId,
        actorSlot,
      );
      return NextResponse.json({
        leagueKey,
        picksBySlot: config.picksBySlot ?? {},
        startedAt: config.startedAtIso,
        waitingSlot: waitingSlot(config),
        picksProjected: projectedDraftOrder(config).length,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Confirm failed" },
        { status: 400 },
      );
    }
  }

  const teamCount = body.teamCount ?? 12;
  const rounds = body.rounds ?? 15;
  const intervalMs = Math.max(1000, body.intervalMs ?? 3000);
  const humanSlots = [
    ...new Set(
      (body.humanSlots && body.humanSlots.length > 0
        ? body.humanSlots
        : [body.userSlot ?? 1]
      ).filter((slot) => Number.isInteger(slot) && slot >= 1 && slot <= teamCount),
    ),
  ].sort((a, b) => a - b);

  // Auto-draft only matters when more than one person is on the hook: a
  // solo/manual mock is driven entirely by one operator, so leave it off there.
  const autoPickMs =
    body.autoPickMs !== undefined
      ? Math.max(0, body.autoPickMs)
      : humanSlots.length >= 2
        ? DEFAULT_AUTO_PICK_MS
        : 0;

  const players: MockPlayerSeed[] = (body.players ?? [])
    .filter((player) => player?.id && player.name && player.position)
    .filter((player) => ALLOWED_POSITIONS.has(String(player.position)))
    .map((player) => ({
      id: String(player.id),
      name: String(player.name),
      position: player.position as MockPlayerSeed["position"],
      team: String(player.team ?? "FA"),
      chenRank: player.chenRank,
      chenTier: player.chenTier,
      adp: player.adp,
      byeWeek: player.byeWeek,
      projectedPoints: player.projectedPoints,
      estimatedReturnProbability: player.estimatedReturnProbability,
    }));

  if (players.length < teamCount * rounds) {
    return NextResponse.json(
      {
        error: shortBoardMessage(players.length, teamCount, rounds),
      },
      { status: 400 },
    );
  }

  const config: MockDraftConfig = {
    leagueKey,
    teamCount,
    rounds,
    humanSlots,
    intervalMs,
    startedAtIso: new Date().toISOString(),
    players,
    picksBySlot: {},
    autoPickMs,
    varietySeed: randomUUID(),
  };

  await saveMockConfig(config);

  return NextResponse.json({
    leagueKey,
    startedAt: config.startedAtIso,
    intervalMs,
    humanSlots,
    autoPickMs,
    totalPicks: teamCount * rounds,
  });
}

export async function GET(request: Request) {
  const leagueKey = new URL(request.url).searchParams.get("leagueKey");
  if (!leagueKey) {
    return NextResponse.json({ error: "leagueKey required" }, { status: 400 });
  }
  await advanceMockAutoPicks(leagueKey);
  const config = await loadMockConfig(leagueKey);
  if (!config) {
    return NextResponse.json({ running: false });
  }
  const now = Date.now();
  const projected = projectedDraftOrder(config);
  const readyCount = Math.min(projected.length, elapsedPickCount(config, now));
  const blockedOn = waitingSlot(config, now);
  const deadline = autoPickDeadline(config);
  return NextResponse.json({
    running: true,
    leagueKey,
    startedAt: config.startedAtIso,
    intervalMs: config.intervalMs,
    teamCount: config.teamCount,
    rounds: config.rounds,
    humanSlots: config.humanSlots ?? (config.userSlot ? [config.userSlot] : []),
    picksMade: readyCount,
    totalPicks: config.teamCount * config.rounds,
    waitingOnUser: blockedOn !== null,
    waitingSlot: blockedOn,
    autoPickMs: config.autoPickMs ?? 0,
    autoPickAt: deadline === null ? null : new Date(deadline).toISOString(),
    picksBySlot: config.picksBySlot ?? {},
    nextPickAt:
      blockedOn !== null
        ? null
        : new Date(
            Date.parse(config.startedAtIso) +
              (readyCount + 1) * config.intervalMs,
          ).toISOString(),
  });
}

export async function DELETE(request: Request) {
  const leagueKey = new URL(request.url).searchParams.get("leagueKey");
  if (!leagueKey) {
    return NextResponse.json({ error: "leagueKey required" }, { status: 400 });
  }
  await prisma.syncCheckpoint
    .delete({ where: { id: checkpointId(leagueKey) } })
    .catch(() => undefined);
  return NextResponse.json({ stopped: true });
}
