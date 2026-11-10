import { afterEach, describe, expect, it } from "vitest";

import { PaneMetrics, paneMetrics } from "./paneMetrics.js";

afterEach(() => {
  paneMetrics.reset();
});

describe("paneMetrics (lp-5q6.33)", () => {
  it("counts open/load/error/close without storing paths", () => {
    const m = new PaneMetrics();
    m.record("open");
    m.record("load");
    m.record("error", "unsupported_type");
    m.record("error", "not_found");
    m.record("close");

    const snap = m.snapshot();
    expect(snap.open_total).toBe(1);
    expect(snap.load_total).toBe(1);
    expect(snap.error_total).toBe(2);
    expect(snap.close_total).toBe(1);
    expect(snap.error_by_code.unsupported_type).toBe(1);
    expect(snap.error_by_code.not_found).toBe(1);

    // Ensure snapshot does not accept path-like pollution via API surface.
    expect(JSON.stringify(snap)).not.toContain("/");
  });
});
