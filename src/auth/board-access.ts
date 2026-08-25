import type { User } from "@prisma/client";
import { AuthError, getCurrentUser, requireActiveUser } from "@/auth/current-user";
import { getDemoClaims, type DemoClaims } from "@/auth/demo-session";
import { LEAGUE_DRAFT_ID } from "@/persistence/league-draft";
import { validateDemoSeat } from "@/persistence/demo-rooms";

export function boardIdForUser(user: Pick<User, "boardId" | "sleeperDraftId">): string {
  if (user.sleeperDraftId) return `sleeper:${user.sleeperDraftId}`;
  if (user.boardId) return user.boardId;
  return LEAGUE_DRAFT_ID;
}

export function requestedDraftId(request: Request): string | null {
  const url = new URL(request.url);
  return url.searchParams.get("draftId")?.trim() || null;
}

export function authorizedBoardIdForUser(
  request: Request,
  user: Pick<User, "boardId" | "sleeperDraftId">,
): string {
  const ownedBoardId = boardIdForUser(user);
  const requested = requestedDraftId(request);
  if (requested && requested !== ownedBoardId) {
    throw new AuthError("You do not have access to that draft board", 403);
  }
  return ownedBoardId;
}

/** Controllers may replace shared state; ordinary house-board members may only pick. */
export function canManageBoard(
  user: Pick<User, "role" | "boardId" | "sleeperDraftId">,
): boolean {
  return user.role === "admin" || boardIdForUser(user) !== LEAGUE_DRAFT_ID;
}

export function requireBoardManager(
  user: Pick<User, "role" | "boardId" | "sleeperDraftId">,
): void {
  if (!canManageBoard(user)) {
    throw new AuthError("Only the board owner can change shared draft settings", 403);
  }
}

export function isDemoDraft(draftId: string) {
  return draftId.startsWith("demo:");
}

export async function requireBoardAccess(
  request: Request,
): Promise<{ draftId: string; user: User | null; demo: DemoClaims | null }> {
  const previewId = requestedDraftId(request) ?? LEAGUE_DRAFT_ID;
  if (isDemoDraft(previewId)) {
    const draftId = previewId;
    const demo = await getDemoClaims(request);
    if (!demo || demo.roomId !== draftId) {
      throw new AuthError("Join the demo room first", 401);
    }
    if (
      demo.role === "play" &&
      !(await validateDemoSeat(draftId, demo.slot, demo.sessionId))
    ) {
      throw new AuthError("Your demo seat expired or was reclaimed", 401);
    }
    return { draftId, user: null, demo };
  }
  const user = await requireActiveUser();
  const draftId = authorizedBoardIdForUser(request, user);
  return { draftId, user, demo: null };
}

export async function requireDemoPlayer(
  draftId: string,
  demo: DemoClaims | null,
): Promise<DemoClaims> {
  if (
    !demo ||
    demo.role !== "play" ||
    !demo.slot ||
    !(await validateDemoSeat(draftId, demo.slot, demo.sessionId))
  ) {
    throw new AuthError("Choose an open demo seat first", 403);
  }
  return demo;
}

export async function optionalBoardAccess(request: Request): Promise<{
  draftId: string;
  user: User | null;
  demo: DemoClaims | null;
}> {
  const requested = requestedDraftId(request);
  if (requested && isDemoDraft(requested)) {
    const draftId = requested;
    const demo = await getDemoClaims(request);
    return { draftId, user: null, demo };
  }
  const user = await getCurrentUser();
  const draftId = user
    ? authorizedBoardIdForUser(request, user)
    : requested ?? LEAGUE_DRAFT_ID;
  return { draftId, user, demo: null };
}
