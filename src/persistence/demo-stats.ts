import { prisma } from "@/persistence/prisma";

export const DEMO_STATS_ID = "demo-stats";

export interface DemoNetworkStats {
  readonly boardsRun: number;
  readonly insightsGiven: number;
  readonly playersHelped: number;
}

export interface DemoStatsState extends DemoNetworkStats {
  readonly countedRoomIds: readonly string[];
  readonly pickWatermarks: Readonly<Record<string, number>>;
  readonly humanWatermarks: Readonly<Record<string, number>>;
}

export interface DemoRoomActivity {
  readonly roomId: string;
  readonly picks: number;
  readonly humans: number;
  readonly complete: boolean;
}

const emptyStats: DemoStatsState = {
  boardsRun: 0,
  insightsGiven: 0,
  playersHelped: 0,
  countedRoomIds: [],
  pickWatermarks: {},
  humanWatermarks: {},
};

export function parseDemoStats(payload?: string | null): DemoStatsState {
  if (!payload) return emptyStats;
  try {
    const parsed = JSON.parse(payload) as Partial<DemoStatsState>;
    const pickWatermarks = numberMap(parsed.pickWatermarks);
    return {
      boardsRun: wholeNumber(parsed.boardsRun),
      insightsGiven: wholeNumber(parsed.insightsGiven),
      playersHelped: wholeNumber(parsed.playersHelped),
      countedRoomIds: Array.isArray(parsed.countedRoomIds)
        ? parsed.countedRoomIds.filter((id): id is string => typeof id === "string")
        : [],
      pickWatermarks,
      humanWatermarks: numberMap(parsed.humanWatermarks),
    };
  } catch {
    return emptyStats;
  }
}

export function applyDemoRoomActivity(
  stats: DemoStatsState,
  activity: DemoRoomActivity,
): DemoStatsState {
  const prevPicks = stats.pickWatermarks[activity.roomId] ?? 0;
  const newPicks = Math.max(0, activity.picks - prevPicks);
  const humans = Math.max(0, activity.humans);
  const prevHumans = stats.humanWatermarks[activity.roomId] ?? 0;
  const counted = new Set(stats.countedRoomIds);
  const pickWatermarks = { ...stats.pickWatermarks };
  const humanWatermarks = { ...stats.humanWatermarks };
  let boardsRun = stats.boardsRun;
  let insightsGiven = stats.insightsGiven;
  let playersHelped = stats.playersHelped;

  if (newPicks > 0) {
    insightsGiven += newPicks * Math.max(humans, 1);
    pickWatermarks[activity.roomId] = activity.picks;
  } else if (activity.picks > 0 && pickWatermarks[activity.roomId] == null) {
    pickWatermarks[activity.roomId] = activity.picks;
  }

  if (humans > prevHumans) {
    playersHelped += humans - prevHumans;
    humanWatermarks[activity.roomId] = humans;
  }

  if (activity.complete && !counted.has(activity.roomId)) {
    counted.add(activity.roomId);
    boardsRun += 1;
  }

  return {
    ...stats,
    boardsRun,
    insightsGiven,
    playersHelped,
    countedRoomIds: [...counted],
    pickWatermarks,
    humanWatermarks,
  };
}

export function applyDemoRoomActivities(
  stats: DemoStatsState,
  activities: readonly DemoRoomActivity[],
): DemoStatsState {
  return activities.reduce(applyDemoRoomActivity, stats);
}

export function forgetDemoRoom(stats: DemoStatsState, roomId: string): DemoStatsState {
  const pickWatermarks = { ...stats.pickWatermarks };
  const humanWatermarks = { ...stats.humanWatermarks };
  delete pickWatermarks[roomId];
  delete humanWatermarks[roomId];
  return {
    ...stats,
    pickWatermarks,
    humanWatermarks,
    countedRoomIds: stats.countedRoomIds.filter((id) => id !== roomId),
  };
}

export function publicDemoStats(stats: DemoStatsState): DemoNetworkStats {
  return {
    boardsRun: stats.boardsRun,
    insightsGiven: stats.insightsGiven,
    playersHelped: stats.playersHelped,
  };
}

function wholeNumber(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : 0;
}

function numberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] =>
        typeof entry[0] === "string" && Number.isFinite(entry[1]),
    ),
  );
}

function statsChanged(before: DemoStatsState, after: DemoStatsState): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

async function mutateDemoStats(
  mutate: (stats: DemoStatsState) => DemoStatsState,
): Promise<DemoStatsState> {
  for (let guard = 0; guard < 8; guard += 1) {
    const row = await prisma.syncCheckpoint.findUnique({
      where: { id: DEMO_STATS_ID },
    });
    const current = parseDemoStats(row?.payload);
    const next = mutate(current);
    if (!statsChanged(current, next)) return current;
    if (!row) {
      try {
        await prisma.syncCheckpoint.create({
          data: {
            id: DEMO_STATS_ID,
            sequence: 1,
            syncedAt: new Date(),
            payload: JSON.stringify(next),
          },
        });
        return next;
      } catch {
        continue;
      }
    }
    const result = await prisma.syncCheckpoint.updateMany({
      where: { id: row.id, sequence: row.sequence },
      data: {
        sequence: row.sequence + 1,
        syncedAt: new Date(),
        payload: JSON.stringify(next),
      },
    });
    if (result.count === 1) return next;
  }
  return parseDemoStats(
    (await prisma.syncCheckpoint.findUnique({ where: { id: DEMO_STATS_ID } }))
      ?.payload,
  );
}

export async function readDemoStats(): Promise<DemoNetworkStats> {
  const row = await prisma.syncCheckpoint.findUnique({
    where: { id: DEMO_STATS_ID },
  });
  return publicDemoStats(parseDemoStats(row?.payload));
}

export async function noteDemoRooms(
  activities: readonly DemoRoomActivity[],
): Promise<DemoNetworkStats> {
  if (activities.length === 0) return readDemoStats();
  return publicDemoStats(await mutateDemoStats((stats) => applyDemoRoomActivities(stats, activities)));
}

export async function forgetDemoRoomStats(roomId: string): Promise<void> {
  await mutateDemoStats((stats) => forgetDemoRoom(stats, roomId));
}

