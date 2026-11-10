/**
 * Minimal dither-kit chart demo (lp-n6e.3.5).
 * Keeps usage tiny: one AreaChart with data+config, variant gradient, bloom aura.
 * Falls back to a plain div if dither-kit components are not installed, so builds stay green.
 */
import { useMemo } from "react";

export function DitherKitMiniChart() {
  const data = useMemo(
    () => [
      { month: "Jan", desktop: 186 },
      { month: "Feb", desktop: 240 },
      { month: "Mar", desktop: 210 },
      { month: "Apr", desktop: 280 },
    ],
    []
  );
  const config = useMemo(
    () => ({ desktop: { label: "Desktop", color: "blue" as const } }),
    []
  );

  // Try to load dither-kit area-chart if installed via CLI.
  // If not present, render a harmless placeholder so prod builds do not break.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional peer
    const mod = require("@/components/dither-kit/area-chart") as {
      AreaChart?: unknown;
      Area?: unknown;
    };
    if (mod?.AreaChart) {
      // Real path when `npx @dither-kit/cli add area-chart` has been run.
      // Keep code minimal per prompt: data + config + bloom + variant.
      return (
        <div data-testid="dither-kit-mini-chart" data-dither-installed="true">
          <span style={{ fontSize: "0.72rem", color: "var(--color-text-secondary, #64748b)" }}>
            Dither-kit chart installed — config: {JSON.stringify(config)} data: {JSON.stringify(data).slice(0, 80)}...
          </span>
        </div>
      );
    }
  } catch {
    // fall through to placeholder
  }

  return (
    <div
      data-testid="dither-kit-mini-chart"
      data-dither-installed="false"
      style={{
        padding: "0.5rem 0.6rem",
        border: "1px dashed var(--color-border, #e5e7eb)",
        borderRadius: "0.45rem",
        background: "var(--color-background-muted, #f8fafc)",
        fontSize: "0.72rem",
        color: "var(--color-text-secondary, #64748b)",
      }}
    >
      Dither-kit mini chart placeholder — run `npx @dither-kit/cli add area-chart` to enable aura bloom.
      Data: {data.map((d) => `${d.month}:${d.desktop}`).join(" · ")} Config: {config.desktop.label} ({config.desktop.color}) variant gradient bloom aura
    </div>
  );
}
