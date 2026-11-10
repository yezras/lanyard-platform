import { apiFetch } from "./client.js";
import type {
  OrgMember,
  OrgMembersResponse,
  SessionShareGrant,
  SessionShareMode,
} from "./types.js";

type ApiErrorBody = {
  error?: string;
  message?: string;
};

async function parseError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  return body.error ?? body.message ?? fallback;
}

export type CreateChatThreadShareInput = {
  threadId: string;
  granteeEmail: string;
  mode: SessionShareMode;
};

export type RevokeChatThreadShareInput = {
  threadId: string;
  granteeUserId: string;
};

export type ListOrgMembersOptions = {
  /** Optional email substring filter (BFF `?q=`). */
  q?: string;
};

/**
 * Same-tenant member directory for the share picker.
 * GET /api/org/members — self already excluded server-side.
 */
export async function listOrgMembers(
  options: ListOrgMembersOptions = {},
): Promise<OrgMember[]> {
  const params = new URLSearchParams();
  if (options.q?.trim()) {
    params.set("q", options.q.trim());
  }
  const query = params.toString();
  const res = await apiFetch(
    `/api/org/members${query ? `?${query}` : ""}`,
  );
  if (!res.ok) {
    throw new Error(
      await parseError(res, `Failed to list org members (${res.status})`),
    );
  }
  const body = (await res.json()) as OrgMembersResponse;
  return body.members ?? [];
}

/**
 * Grant another same-tenant user access to a chat thread.
 * POST /api/chat/threads/:threadId/shares
 */
export async function createChatThreadShare(
  input: CreateChatThreadShareInput,
): Promise<SessionShareGrant> {
  const res = await apiFetch(`/api/chat/threads/${input.threadId}/shares`, {
    method: "POST",
    body: JSON.stringify({
      grantee_email: input.granteeEmail,
      mode: input.mode,
    }),
  });
  if (!res.ok) {
    throw new Error(
      await parseError(res, `Failed to create share (${res.status})`),
    );
  }
  return (await res.json()) as SessionShareGrant;
}

/**
 * Owner view: list active (and historical) grants for a thread.
 * GET /api/chat/threads/:threadId/shares
 */
export async function listChatThreadShares(
  threadId: string,
): Promise<SessionShareGrant[]> {
  const res = await apiFetch(`/api/chat/threads/${threadId}/shares`);
  if (!res.ok) {
    throw new Error(
      await parseError(res, `Failed to list shares (${res.status})`),
    );
  }
  const body = (await res.json()) as { grants?: SessionShareGrant[] };
  return body.grants ?? [];
}

/**
 * Revoke a grantee's access to a thread.
 * DELETE /api/chat/threads/:threadId/shares/:granteeUserId
 */
export async function revokeChatThreadShare(
  input: RevokeChatThreadShareInput,
): Promise<SessionShareGrant> {
  const res = await apiFetch(
    `/api/chat/threads/${input.threadId}/shares/${input.granteeUserId}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    throw new Error(
      await parseError(res, `Failed to revoke share (${res.status})`),
    );
  }
  return (await res.json()) as SessionShareGrant;
}
