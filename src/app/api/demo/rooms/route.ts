import { NextResponse } from "next/server";
import { partitionDemoRooms } from "@/domain/demo-lobby";
import { listDemoRooms } from "@/persistence/demo-rooms";
import { readDemoStats } from "@/persistence/demo-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const all = await listDemoRooms();
    const { open, closed } = partitionDemoRooms(all);
    const joinable = open.filter((room) => room.openSeats > 0);
    const totalOpenSeats = joinable.reduce((sum, room) => sum + room.openSeats, 0);
    const activePlayers = open.reduce((sum, room) => sum + room.activeSeats, 0);
    return NextResponse.json({
      totalRooms: all.length,
      openRooms: open.length,
      closedRooms: closed.length,
      joinableRooms: joinable.length,
      totalOpenSeats,
      activePlayers,
      stats: await readDemoStats(),
      rooms: all.map((room, index) => ({
        id: room.id,
        name: `Room ${index + 1}`,
        totalSeats: room.totalSeats,
        activeSeats: room.activeSeats,
        openSeats: room.openSeats,
        openSeatList: room.openSeatList,
        scoring: room.scoring,
        rounds: room.rounds,
        picks: room.picks,
        totalPicks: room.totalPicks,
        started: room.started,
        complete: room.complete,
        exhausted: room.exhausted,
      })),
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load public draft rooms" },
      { status: 503 },
    );
  }
}
