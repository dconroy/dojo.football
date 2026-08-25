import type { User } from "@prisma/client";
import type { DemoClaims } from "@/auth/demo-session";
import { canManageBoard } from "@/auth/board-access";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/config/strategy";
import { playerRevision } from "@/lib/board-sync";
import {
  draftStateFor,
  getDraftMeta,
  getOrCreateLeagueDraft,
  listMemberSeats,
  userPrefs,
  type SharedDraft,
} from "@/persistence/league-draft";
import {
  demoClientState,
  demoSeatMembers,
  isDemoRoomId,
  syncDemoBoardFromMock,
} from "@/persistence/demo-rooms";

async function withAudience(
  shared: SharedDraft,
  user: User | null,
  demo: DemoClaims | null,
) {
  if (demo) {
    const slot = demo.slot ?? 0;
    const members = await demoSeatMembers(shared.id);
    const member = members.find((candidate) => candidate.draftSlot === slot);
    const displayName =
      demo.role === "play"
        ? member?.displayName ?? "Human"
        : "Spectator";
    return {
      ...shared,
      draft: draftStateFor(shared, slot),
      members,
      me: {
        id:
          demo.role === "play"
            ? `demo:${shared.id}:${slot}`
            : `demo:${shared.id}:spectator`,
        displayName,
        role: "member" as const,
        draftSlot: slot,
        teamName: demo.role === "play" ? displayName : "Watching",
        pins: [] as string[],
        avoids: [] as string[],
        weights: DEFAULT_STRATEGY_WEIGHTS,
      darkMode: true,
      canManageBoard: false,
      },
      demo: {
        role: demo.role,
        slot: demo.slot,
        roomId: demo.roomId,
        ...(await demoClientState(shared.id)),
      },
    };
  }
  if (!user) throw new Error("Authentication required");
  const prefs = userPrefs(user);
  const members = await listMemberSeats(shared.id);
  return {
    ...shared,
    draft: draftStateFor(shared, prefs.draftSlot),
    members,
    me: {
      id: user.id,
      displayName: user.displayName,
      role: user.role,
      canManageBoard: canManageBoard(user),
      ...prefs,
    },
  };
}

export async function boardPayload(
  draftId: string,
  user: User | null,
  demo: DemoClaims | null,
) {
  if (isDemoRoomId(draftId)) {
    await syncDemoBoardFromMock(draftId);
  }
  return withAudience(await getOrCreateLeagueDraft(draftId), user, demo);
}

/** Heartbeat: skip `playersJson` unless rankings changed. */
export async function boardPollPayload(
  draftId: string,
  user: User | null,
  demo: DemoClaims | null,
  query: { readonly since?: string | null; readonly playersRev?: string | null },
) {
  if (isDemoRoomId(draftId)) {
    await syncDemoBoardFromMock(draftId);
  }
  const meta = await getDraftMeta(draftId);
  if (!meta) return boardPayload(draftId, user, demo);

  const rev = playerRevision(meta.importedAt, meta.source);
  const playersUnchanged = Boolean(query.playersRev) && query.playersRev === rev;
  const boardUnchanged = Boolean(query.since) && query.since === meta.updatedAt;
  const stub: SharedDraft = { ...meta, players: [] };

  if (boardUnchanged && playersUnchanged) {
    const envelope = await withAudience(stub, user, demo);
    return {
      unchanged: true as const,
      updatedAt: meta.updatedAt,
      importedAt: meta.importedAt,
      source: meta.source,
      members: envelope.members,
      me: envelope.me,
      ..."demo" in envelope && envelope.demo ? { demo: envelope.demo } : {},
    };
  }

  if (playersUnchanged) {
    const envelope = await withAudience(stub, user, demo);
    return {
      ...envelope,
      players: undefined,
      playersOmitted: true as const,
    };
  }

  return boardPayload(draftId, user, demo);
}
