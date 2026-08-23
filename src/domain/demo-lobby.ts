export const DEMO_ROOM_PAGE_SIZE = 5;

export function partitionDemoRooms<T extends { complete: boolean; openSeats?: number }>(
  rooms: readonly T[],
): { open: T[]; closed: T[] } {
  const open: T[] = [];
  const closed: T[] = [];
  for (const room of rooms) {
    if (room.complete) closed.push(room);
    else open.push(room);
  }
  open.sort((left, right) => Number((right.openSeats ?? 0) > 0) - Number((left.openSeats ?? 0) > 0));
  return { open, closed };
}

export function formatDemoStat(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.floor(value)));
}
