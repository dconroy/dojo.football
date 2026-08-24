export interface SnakeSelection {
  readonly overall: number;
  readonly round: number;
  readonly slot: number;
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

export function overallPickFor(round: number, slot: number, teamCount = 12): number {
  positiveInteger(round, "round");
  positiveInteger(teamCount, "teamCount");
  if (!Number.isInteger(slot) || slot < 1 || slot > teamCount) {
    throw new RangeError(`slot must be between 1 and ${teamCount}`);
  }
  const positionInRound = round % 2 === 1 ? slot : teamCount - slot + 1;
  return (round - 1) * teamCount + positionInRound;
}

export function selectionForOverall(overall: number, teamCount: number): SnakeSelection {
  positiveInteger(overall, "overall");
  positiveInteger(teamCount, "teamCount");
  const round = Math.floor((overall - 1) / teamCount) + 1;
  const positionInRound = ((overall - 1) % teamCount) + 1;
  const slot = round % 2 === 1 ? positionInRound : teamCount - positionInRound + 1;
  return { overall, round, slot };
}

export function picksForSlot(
  slot: number,
  rounds = 15,
  teamCount = 12,
): readonly SnakeSelection[] {
  positiveInteger(rounds, "rounds");
  return Array.from({ length: rounds }, (_, index) => {
    const round = index + 1;
    return { overall: overallPickFor(round, slot, teamCount), round, slot };
  });
}

/** Returns the first selection at or after `currentOverall`. */
export function nextSelectionForSlot(
  currentOverall: number,
  slot: number,
  rounds = 15,
  teamCount = 12,
): SnakeSelection | null {
  positiveInteger(currentOverall, "currentOverall");
  return (
    picksForSlot(slot, rounds, teamCount).find(
      (selection) => selection.overall >= currentOverall,
    ) ?? null
  );
}

export function followingSelectionForSlot(
  currentOverall: number,
  slot: number,
  rounds = 15,
  teamCount = 12,
): SnakeSelection | null {
  const next = nextSelectionForSlot(currentOverall, slot, rounds, teamCount);
  if (!next) return null;
  return (
    picksForSlot(slot, rounds, teamCount).find(
      (selection) => selection.overall > next.overall,
    ) ?? null
  );
}

/** Number of selections remaining before the user's upcoming turn. */
export function picksUntilNextSelection(
  currentOverall: number,
  slot: number,
  rounds = 15,
  teamCount = 12,
): number | null {
  const next = nextSelectionForSlot(currentOverall, slot, rounds, teamCount);
  return next ? next.overall - currentOverall : null;
}

/** Number of selections made by other teams between the user's next two turns. */
export function picksUntilFollowingSelection(
  currentOverall: number,
  slot: number,
  rounds = 15,
  teamCount = 12,
): number | null {
  const next = nextSelectionForSlot(currentOverall, slot, rounds, teamCount);
  const following = followingSelectionForSlot(currentOverall, slot, rounds, teamCount);
  return next && following ? following.overall - next.overall - 1 : null;
}
