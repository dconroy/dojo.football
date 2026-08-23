export function requiredPickCount(teamCount: number, rounds: number): number {
  return teamCount * rounds;
}

export function uniquePlayerCount(
  players: readonly { readonly id?: string; readonly sourceId?: string }[],
): number {
  const keys = players
    .map((player) => player.id ?? player.sourceId)
    .filter((key): key is string => Boolean(key));
  return keys.length === 0 ? players.length : new Set(keys).size;
}

export function draftBoardExhausted(input: {
  readonly picks: number;
  readonly playerCount: number;
  readonly teamCount: number;
  readonly rounds: number;
}): boolean {
  const need = requiredPickCount(input.teamCount, input.rounds);
  if (input.picks >= need) return false;
  if (input.playerCount <= 0) return false;
  return input.picks >= input.playerCount;
}

export function draftIsFinished(input: {
  readonly picks: number;
  readonly playerCount: number;
  readonly teamCount: number;
  readonly rounds: number;
}): boolean {
  return (
    input.picks >= requiredPickCount(input.teamCount, input.rounds) ||
    draftBoardExhausted(input)
  );
}

export function shortBoardMessage(
  playerCount: number,
  teamCount: number,
  rounds: number,
): string {
  const need = requiredPickCount(teamCount, rounds);
  return `${teamCount} teams × ${rounds} rounds needs ${need} players; this list has ${playerCount}. Pick fewer rounds or load a deeper ranking source.`;
}

/** Copy for the lobby when someone is sizing a new room. */
export function draftSizeNote(teamCount: number, rounds: number): string {
  const need = requiredPickCount(teamCount, rounds);
  if (need >= 192) {
    return `${teamCount} teams × ${rounds} rounds is ${need} picks. We'll add extra rankings if the main list is short.`;
  }
  return `${need} picks in this room.`;
}
