import { describe, expect, it } from "vitest";

import {
  VAULT_LAYOUT_CONTENT_PADDING,
  vaultEditorBodyStyle,
  vaultPreviewBodyStyle,
} from "./vaultLayout.js";

describe("vaultLayout padding tokens (lp-75r.2)", () => {
  it("LayoutContent padding is zero for OnlyOffice edge-to-edge", () => {
    expect(VAULT_LAYOUT_CONTENT_PADDING).toBe(0);
  });

  it("editor body matches chat documentPaneEditorBodyStyle intent (pad 0)", () => {
    expect(vaultEditorBodyStyle.padding).toBe(0);
    expect(vaultEditorBodyStyle.overflow).toBe("hidden");
  });

  it("preview body keeps internal spacing for markdown/reader", () => {
    expect(String(vaultPreviewBodyStyle.padding)).toContain("spacing-6");
    expect(vaultPreviewBodyStyle.boxSizing).toBe("border-box");
  });
});
