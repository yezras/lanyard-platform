import type { ChatThread, ChatThreadStore } from "./chat-store.js";
import type {
  ControlPlaneAuthClient,
  SessionShareGrant,
  SessionShareMode,
} from "./control-plane-client.js";

export type ThreadAccessLevel = "owner" | SessionShareMode;

export type ResolvedThreadAccess = {
  thread: ChatThread;
  access: ThreadAccessLevel;
  grant: SessionShareGrant | null;
};

export async function resolveThreadAccess(
  chatThreads: ChatThreadStore,
  authClient: ControlPlaneAuthClient,
  input: {
    tenantId: string;
    userId: string;
    threadId: string;
  },
): Promise<ResolvedThreadAccess | null> {
  const owned = chatThreads.getForUser(
    input.threadId,
    input.tenantId,
    input.userId,
  );
  if (owned) {
    return { thread: owned, access: "owner", grant: null };
  }

  const thread = chatThreads.getInTenant(input.threadId, input.tenantId);
  if (!thread) {
    return null;
  }

  const grant = await authClient.getActiveSessionShare(
    input.tenantId,
    input.userId,
    input.threadId,
  );
  if (!grant) {
    return null;
  }

  return {
    thread,
    access: grant.mode,
    grant,
  };
}

export function canSendMessages(access: ThreadAccessLevel): boolean {
  return access === "owner" || access === "collaborate";
}