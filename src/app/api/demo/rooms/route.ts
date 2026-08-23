import { NextResponse } from "next/server";
import { listDemoRooms } from "@/persistence/demo-rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const all = await listDemoRooms();
    // Rooms someone can still join: not complete and at least one open seat.
    const live = all.filter((room) => !room.complete);
    const joinable = live.filter((room) => room.openSeats > 0);
    const totalOpenSeats = joinable.reduce((sum, room) => sum + room.openSeats, 0);
    const activePlayers = live.reduce((sum, room) => sum + room.activeSeats, 0);
    return NextResponse.json({
      totalRooms: all.length,
      joinableRooms: joinable.length,
      totalOpenSeats,
      activePlayers,
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
