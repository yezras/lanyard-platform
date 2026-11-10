import { apiFetch } from "./client.js";
import { withApiBase } from "./tenantBase.js";
import type {
  SettingsCronCreateBody,
  SettingsCronCreateResponse,
  SettingsCronDetail,
  SettingsCronPatchResponse,
  SettingsCronSchedule,
  SettingsHealthCheckResponse,
  SettingsHostContent,
  SettingsHostList,
  SettingsMcpPatchResponse,
  SettingsModelPatchResponse,
  SettingsSkillPatchResponse,
  SettingsSnapshot,
} from "./types.js";

type ApiErrorBody = { error?: string; code?: string };

async function parseError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  return body.error ?? fallback;
}

export type SettingsContentError = Error & {
  status?: number;
  code?: string;
};

export async function fetchSettingsSnapshot(): Promise<SettingsSnapshot> {
  const res = await fetch(withApiBase("/api/settings/snapshot"), {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(await parseError(res, `Settings snapshot failed (${res.status})`));
  }
  return (await res.json()) as SettingsSnapshot;
}

export async function refreshSettingsHealth(): Promise<SettingsHealthCheckResponse> {
  const res = await apiFetch("/api/settings/health-check", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(await parseError(res, `Settings health check failed (${res.status})`));
  }
  return (await res.json()) as SettingsHealthCheckResponse;
}

export async function patchSettingsSkill(
  skillId: string,
  enabled: boolean,
): Promise<SettingsSkillPatchResponse> {
  const res = await apiFetch(`/api/settings/skills/${encodeURIComponent(skillId)}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    throw new Error(await parseError(res, `Skill update failed (${res.status})`));
  }
  return (await res.json()) as SettingsSkillPatchResponse;
}

/**
 * Body for PATCH /api/settings/crons/:id.
 * - `{ enabled }` only → host `cron.set_enabled`
 * - name / prompt / schedule / skills present → host `cron.update`
 */
export type SettingsCronPatchBody = {
  enabled?: boolean;
  name?: string;
  prompt?: string;
  /** Alias for prompt (create/update wire). */
  instructions?: string;
  schedule?: string | SettingsCronSchedule;
  skills?: string[];
};

/**
 * PATCH /api/settings/crons/:id — toggle enabled and/or full job update.
 * Pass a boolean for enable-only (backward compatible), or a body object for
 * cron.update fields (lp-lv9.5 instructions edit).
 */
export async function patchSettingsCron(
  cronId: string,
  enabledOrBody: boolean | SettingsCronPatchBody,
): Promise<SettingsCronPatchResponse> {
  const body: SettingsCronPatchBody =
    typeof enabledOrBody === "boolean"
      ? { enabled: enabledOrBody }
      : enabledOrBody;
  const res = await apiFetch(`/api/settings/crons/${encodeURIComponent(cronId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      await parseError(res, `Scheduled task update failed (${res.status})`),
    );
  }
  return (await res.json()) as SettingsCronPatchResponse;
}

/**
 * POST /api/settings/crons — create full scheduled task (lp-jzl.3 / lp-jzl.5 / lp-jzl.9.1).
 * Body uses structured schedule from scheduleCodec / form / chat wizard;
 * never requires the user to supply a raw cron string.
 */
export async function createSettingsCron(
  body: SettingsCronCreateBody,
): Promise<SettingsCronCreateResponse> {
  const res = await apiFetch("/api/settings/crons", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      await parseError(res, `Scheduled task create failed (${res.status})`),
    );
  }
  return (await res.json()) as SettingsCronCreateResponse;
}

export async function patchSettingsMcp(
  mcpName: string,
  enabled: boolean,
): Promise<SettingsMcpPatchResponse> {
  const res = await apiFetch(
    `/api/settings/mcp/${encodeURIComponent(mcpName)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    },
  );
  if (!res.ok) {
    throw new Error(await parseError(res, `MCP update failed (${res.status})`));
  }
  return (await res.json()) as SettingsMcpPatchResponse;
}

export async function patchSettingsActiveModel(
  provider: string,
  model: string,
): Promise<SettingsModelPatchResponse> {
  const res = await apiFetch("/api/settings/models/active", {
    method: "PATCH",
    body: JSON.stringify({ provider, model }),
  });
  if (!res.ok) {
    throw new Error(
      await parseError(res, `Model update failed (${res.status})`),
    );
  }
  return (await res.json()) as SettingsModelPatchResponse;
}

/**
 * Fetch a settings host-home file body (skill SKILL.md, workflow def, etc.).
 * Paths are relative to BACKEND_HOME / HERMES_HOME — not vault paths.
 */
export async function fetchSettingsHostContent(
  path: string,
): Promise<SettingsHostContent> {
  const res = await fetch(
    withApiBase(`/api/settings/content?path=${encodeURIComponent(path)}`),
    { credentials: "include" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    const err = new Error(
      body.error ?? `Settings content failed (${res.status})`,
    ) as SettingsContentError;
    err.status = res.status;
    err.code = body.code;
    throw err;
  }
  return (await res.json()) as SettingsHostContent;
}

/**
 * List one level of a host-home directory (skill pack siblings, lp-75r.4).
 * Paths are relative to BACKEND_HOME / HERMES_HOME — not vault paths.
 */
export async function fetchSettingsHostList(
  path: string,
): Promise<SettingsHostList> {
  const res = await fetch(
    withApiBase(`/api/settings/list?path=${encodeURIComponent(path)}`),
    { credentials: "include" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    const err = new Error(
      body.error ?? `Settings list failed (${res.status})`,
    ) as SettingsContentError;
    err.status = res.status;
    err.code = body.code;
    throw err;
  }
  return (await res.json()) as SettingsHostList;
}

/**
 * Fetch on-demand scheduled task detail (command / prompt / payload) from the host.
 * Wire path remains `/api/settings/crons/:id/detail` for compatibility (lp-jzl.4).
 * Falls back gracefully when fixture-only or job has no extra fields.
 */
export async function fetchSettingsCronDetail(
  cronId: string,
): Promise<SettingsCronDetail> {
  const res = await fetch(
    withApiBase(`/api/settings/crons/${encodeURIComponent(cronId)}/detail`),
    { credentials: "include" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    const err = new Error(
      body.error ?? `Scheduled task detail failed (${res.status})`,
    ) as SettingsContentError;
    err.status = res.status;
    err.code = body.code;
    throw err;
  }
  return (await res.json()) as SettingsCronDetail;
}
