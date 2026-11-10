/**
 * Client-side document pane metrics (lp-5q6.33).
 *
 * In-process counters only — no network export required for this bead.
 * Never records path, title, body, tokens, or JWT.
 */

export type PaneMetricKind = "open" | "load" | "error" | "close";

export type PaneMetricsSnapshot = {
  open_total: number;
  load_total: number;
  error_total: number;
  close_total: number;
  error_by_code: Record<string, number>;
};

function empty(): PaneMetricsSnapshot {
  return {
    open_total: 0,
    load_total: 0,
    error_total: 0,
    close_total: 0,
    error_by_code: {},
  };
}

export class PaneMetrics {
  private snap: PaneMetricsSnapshot = empty();

  reset(): void {
    this.snap = empty();
  }

  snapshot(): PaneMetricsSnapshot {
    return {
      ...this.snap,
      error_by_code: { ...this.snap.error_by_code },
    };
  }

  record(kind: PaneMetricKind, errorCode?: string): void {
    switch (kind) {
      case "open":
        this.snap.open_total += 1;
        break;
      case "load":
        this.snap.load_total += 1;
        break;
      case "close":
        this.snap.close_total += 1;
        break;
      case "error": {
        this.snap.error_total += 1;
        const code = (errorCode ?? "unknown").slice(0, 64);
        this.snap.error_by_code[code] =
          (this.snap.error_by_code[code] ?? 0) + 1;
        break;
      }
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  }
}

/** Shared module instance for the web app. */
export const paneMetrics = new PaneMetrics();
