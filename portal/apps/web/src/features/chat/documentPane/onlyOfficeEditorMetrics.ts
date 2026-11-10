/**
 * Client-side office_editor_load metrics (lp-5q6.27 / lp-5q6.33).
 * Codes only — never path, JWT, or document body.
 */

export type OfficeEditorLoadOutcome = "success" | "error" | "denied";

export type OfficeEditorMetricsSnapshot = {
  editor_load_total: number;
  editor_load_by_outcome: Record<string, number>;
  editor_load_by_error_code: Record<string, number>;
};

function empty(): OfficeEditorMetricsSnapshot {
  return {
    editor_load_total: 0,
    editor_load_by_outcome: {},
    editor_load_by_error_code: {},
  };
}

export class OfficeEditorMetrics {
  private snap: OfficeEditorMetricsSnapshot = empty();

  reset(): void {
    this.snap = empty();
  }

  snapshot(): OfficeEditorMetricsSnapshot {
    return {
      editor_load_total: this.snap.editor_load_total,
      editor_load_by_outcome: { ...this.snap.editor_load_by_outcome },
      editor_load_by_error_code: { ...this.snap.editor_load_by_error_code },
    };
  }

  recordLoad(input: {
    outcome: OfficeEditorLoadOutcome;
    error_code?: string;
  }): void {
    this.snap.editor_load_total += 1;
    const outcome = input.outcome;
    this.snap.editor_load_by_outcome[outcome] =
      (this.snap.editor_load_by_outcome[outcome] ?? 0) + 1;
    if (input.error_code && outcome !== "success") {
      const code = input.error_code.slice(0, 64);
      this.snap.editor_load_by_error_code[code] =
        (this.snap.editor_load_by_error_code[code] ?? 0) + 1;
    }
  }
}

export const officeEditorMetrics = new OfficeEditorMetrics();
