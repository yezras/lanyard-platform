/**
 * BFF → harness HTTP client (plan 0015 / lp-oop.14 / lp-oop.16).
 *
 * Service token, start turn, SSE, interrupt, settings snapshot.
 * POST /messages, GET events, POST cancel, and GET /settings/snapshot
 * (cp_s3+harness) use this client when ChatDelivery=harness.
 */

import {
  HARNESS_SERVICE_TOKEN_HEADER,
  HARNESS_SETTINGS_MODELS_ACTIVE_PATH,
  HARNESS_SETTINGS_SNAPSHOT_PATH,
  HARNESS_TURNS_PATH,
  asTurnId,
  harnessSettingsMcpPath,
  harnessSettingsSkillPath,
  harnessTurnEventsPath,
  harnessTurnInterruptPath,
  isTurnId,
  parseHarnessSseDataLine,
  type TurnEvent,
  type TurnId,
  type TurnRequest,
} from "@lanyard/shared";

export type HarnessHttpResponse = {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  readonly body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
};

export function readableStreamFromText(
  text: string,
): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      if (encoded.byteLength > 0) controller.enqueue(encoded);
      controller.close();
    },
  });
}

/** Prefer a live body; fall back to buffering `text()` (fake harness). */
export async function harnessEventStreamBody(
  response: HarnessHttpResponse,
): Promise<ReadableStream<Uint8Array> | null> {
  if (response.body) return response.body;
  const text = await response.text();
  if (!text) return null;
  return readableStreamFromText(text);
}

export type HarnessRequestFn = (
  input: string,
  init?: RequestInit,
) => Promise<HarnessHttpResponse>;

export type HarnessStartTurnResult =
  | { ok: true; turn_id: TurnId }
  | { ok: false; status: number; error: string };

export type HarnessInterruptResult =
  | { ok: true; interrupted: true }
  | { ok: false; status: number; error: string };

export type HarnessSettingsSnapshotResult =
  | { ok: true; snapshot: Record<string, unknown> }
  | { ok: false; status: number; error: string };

export type HarnessActiveModelResult =
  | {
      ok: true;
      model: {
        provider: string;
        model: string;
        is_active?: boolean;
        connected?: boolean;
      };
      source: string;
    }
  | { ok: false; status: number; error: string };

export type HarnessSettingsSnapshotHttpError = {
  status: 503;
  body: {
    error: string;
    code: "unavailable";
    retryable: true;
    unavailable: true;
  };
};

type JsonMap = Record<string, unknown>;

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonMap)
    : {};
}

function uniqueStrings(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Advertise Tools inventory + model select on ChatDelivery=harness.
 * settings.patch gates skill/MCP toggles; models.set_active gates Set active.
 */
export function mergeHarnessModelCapabilities(input: {
  ui?: unknown;
  backend_capabilities?: unknown;
  vaultEdit: boolean;
}): { ui: JsonMap; backend_capabilities: JsonMap } {
  const ui = asRecord(input.ui);
  const can = asRecord(ui.can);
  const affordances = asRecord(ui.affordances);
  const caps = asRecord(input.backend_capabilities);
  const features = asRecord(caps.features);
  const methods = Array.isArray(caps.brain_rpc_methods)
    ? [...caps.brain_rpc_methods]
    : [];
  const uiAffordances = asRecord(caps.ui_affordances);
  return {
    ui: {
      ...ui,
      affordances: {
        ...affordances,
        model_selector: "supported",
        settings_page: "supported",
        settings_editor: "supported",
      },
      can: {
        ...can,
        vault_edit: input.vaultEdit,
        model_select: true,
        settings_view: true,
        settings_edit: true,
      },
    },
    backend_capabilities: {
      ...caps,
      features: {
        ...features,
        models: true,
        settings_snapshot: true,
        settings_patch: true,
        cron: true,
      },
      brain_rpc_methods: uniqueStrings([
        ...methods,
        "models.list",
        "models.set_active",
        "settings.snapshot",
        "settings.patch",
        "cron.create",
        "cron.update",
        "cron.patch",
      ]),
      ui_affordances: {
        ...uiAffordances,
        model_selector: "supported",
        settings_page: "supported",
        settings_editor: "supported",
      },
    },
  };
}

export type HarnessEnabledPatchResult =
  | {
      ok: true;
      source: string;
      skill?: Record<string, unknown>;
      mcp?: Record<string, unknown>;
    }
  | { ok: false; status: number; error: string };

/** Honest fail-closed body for Tools / settings snapshot on the harness hop. */
export function harnessSettingsSnapshotHttpError(
  kind: "missing_client" | "unavailable" | { status: number; error: string },
): HarnessSettingsSnapshotHttpError {
  if (kind === "missing_client") {
    return {
      status: 503,
      body: {
        error:
          "Settings snapshot is harness but no harness client is configured (set HARNESS_URL)",
        code: "unavailable",
        retryable: true,
        unavailable: true,
      },
    };
  }
  if (kind === "unavailable") {
    return {
      status: 503,
      body: {
        error: "Harness settings snapshot is unavailable",
        code: "unavailable",
        retryable: true,
        unavailable: true,
      },
    };
  }
  return {
    status: 503,
    body: {
      error:
        kind.status === 404
          ? "Harness settings snapshot is not available"
          : kind.error || "Harness settings snapshot is unavailable",
      code: "unavailable",
      retryable: true,
      unavailable: true,
    },
  };
}

export class HarnessClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly requestFn: HarnessRequestFn = fetch,
  ) {}

  private headers(extra?: Record<string, string>): Headers {
    const headers = new Headers(extra ?? undefined);
    headers.set(HARNESS_SERVICE_TOKEN_HEADER, this.serviceToken);
    return headers;
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  async startTurn(request: TurnRequest): Promise<HarnessStartTurnResult> {
    // lp-8sh4.6: a network-level failure (harness offline) is a structured
    // 503 result, never an unhandled throw — the composer must show an
    // honest, actionable error instead of "Internal server error".
    let response: HarnessHttpResponse;
    try {
      response = await this.requestFn(this.url(HARNESS_TURNS_PATH), {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify(request),
      });
    } catch {
      return {
        ok: false,
        status: 503,
        error: `Agent runtime unreachable at ${this.baseUrl} — wake the sandbox (or check HARNESS_URL) and retry.`,
      };
    }

    const body = (await response.json().catch(() => ({}))) as {
      turn_id?: unknown;
      error?: string;
    };

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body.error ?? "Harness start turn failed",
      };
    }

    if (typeof body.turn_id !== "string" || !isTurnId(body.turn_id)) {
      return {
        ok: false,
        status: 502,
        error: "Harness start turn response missing turn_id",
      };
    }

    return { ok: true, turn_id: asTurnId(body.turn_id) };
  }

  /**
   * Opens harness SSE for a turn. Caller must consume/abort the body.
   */
  async openTurnEventStream(
    turnId: string,
    signal?: AbortSignal,
  ): Promise<HarnessHttpResponse> {
    return this.requestFn(this.url(harnessTurnEventsPath(turnId)), {
      method: "GET",
      headers: this.headers({ accept: "text/event-stream" }),
      signal,
    });
  }

  async interruptTurn(turnId: string): Promise<HarnessInterruptResult> {
    let response: HarnessHttpResponse;
    try {
      response = await this.requestFn(
        this.url(harnessTurnInterruptPath(turnId)),
        {
          method: "POST",
          headers: this.headers({ "content-type": "application/json" }),
        },
      );
    } catch {
      // lp-8sh4.6: harness offline is a structured 503, not a thrown 500.
      return {
        ok: false,
        status: 503,
        error: `Agent runtime unreachable at ${this.baseUrl}.`,
      };
    }

    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body.error ?? "Harness interrupt failed",
      };
    }

    return { ok: true, interrupted: true };
  }

  /**
   * GET /internal/settings/snapshot. Tools SoT on cp_s3+harness.
   * Fail-closed on 404 / non-JSON / missing exported_at — never a fixture.
   */
  async getSettingsSnapshot(): Promise<HarnessSettingsSnapshotResult> {
    let response: HarnessHttpResponse;
    try {
      response = await this.requestFn(
        this.url(HARNESS_SETTINGS_SNAPSHOT_PATH),
        {
          method: "GET",
          headers: this.headers({ accept: "application/json" }),
        },
      );
    } catch {
      return {
        ok: false,
        status: 503,
        error: "Harness settings snapshot is unavailable",
      };
    }

    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      exported_at?: unknown;
    };

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body.error ?? "Harness settings snapshot failed",
      };
    }

    if (typeof body.exported_at !== "string" || !body.exported_at) {
      return {
        ok: false,
        status: 502,
        error: "Harness settings snapshot response missing exported_at",
      };
    }

    return { ok: true, snapshot: body as Record<string, unknown> };
  }

  /**
   * PATCH /internal/settings/models/active. Next harness turn uses this model.
   * Fail-closed — never writes a local fixture.
   */
  async patchActiveModel(
    provider: string,
    model: string,
  ): Promise<HarnessActiveModelResult> {
    let response: HarnessHttpResponse;
    try {
      response = await this.requestFn(
        this.url(HARNESS_SETTINGS_MODELS_ACTIVE_PATH),
        {
          method: "PATCH",
          headers: this.headers({ "content-type": "application/json" }),
          body: JSON.stringify({ provider, model }),
        },
      );
    } catch {
      return {
        ok: false,
        status: 503,
        error: "Harness set active model is unavailable",
      };
    }

    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      source?: unknown;
      model?: {
        provider?: unknown;
        model?: unknown;
        is_active?: unknown;
        connected?: unknown;
      };
    };

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body.error ?? "Harness set active model failed",
      };
    }

    const nextProvider =
      typeof body.model?.provider === "string" ? body.model.provider.trim() : "";
    const nextModel =
      typeof body.model?.model === "string" ? body.model.model.trim() : "";
    if (!nextProvider || !nextModel) {
      return {
        ok: false,
        status: 502,
        error: "Harness set active model response missing model",
      };
    }

    return {
      ok: true,
      source: typeof body.source === "string" && body.source ? body.source : "harness",
      model: {
        provider: nextProvider,
        model: nextModel,
        is_active: body.model?.is_active !== false,
        connected: body.model?.connected !== false,
      },
    };
  }

  /**
   * PATCH /internal/settings/skills/:id `{ enabled }`. Vault config.yaml, not guest disk.
   */
  async patchSkillEnabled(
    skillId: string,
    enabled: boolean,
  ): Promise<HarnessEnabledPatchResult> {
    return this.patchEnabled(
      harnessSettingsSkillPath(skillId),
      enabled,
      "skill",
      "Harness skill toggle is unavailable",
    );
  }

  /**
   * PATCH /internal/settings/mcp/:name `{ enabled }`. Vault config.yaml, not guest disk.
   */
  async patchMcpEnabled(
    mcpName: string,
    enabled: boolean,
  ): Promise<HarnessEnabledPatchResult> {
    return this.patchEnabled(
      harnessSettingsMcpPath(mcpName),
      enabled,
      "mcp",
      "Harness MCP toggle is unavailable",
    );
  }

  private async patchEnabled(
    path: string,
    enabled: boolean,
    entity: "skill" | "mcp",
    unavailable: string,
  ): Promise<HarnessEnabledPatchResult> {
    let response: HarnessHttpResponse;
    try {
      response = await this.requestFn(this.url(path), {
        method: "PATCH",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({ enabled }),
      });
    } catch {
      return { ok: false, status: 503, error: unavailable };
    }

    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      source?: unknown;
      skill?: Record<string, unknown>;
      mcp?: Record<string, unknown>;
    };

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body.error ?? unavailable,
      };
    }

    const row = entity === "skill" ? body.skill : body.mcp;
    if (!row || typeof row !== "object") {
      return {
        ok: false,
        status: 502,
        error: `Harness ${entity} toggle response missing ${entity}`,
      };
    }

    return {
      ok: true,
      source:
        typeof body.source === "string" && body.source ? body.source : "harness",
      [entity]: row,
    };
  }
}

/** Parse SSE `data:` lines from a harness events body. */
export function collectHarnessTurnEvents(sseText: string): TurnEvent[] {
  return sseText
    .split("\n")
    .map((line) => parseHarnessSseDataLine(line))
    .filter((event): event is TurnEvent => event !== null);
}
