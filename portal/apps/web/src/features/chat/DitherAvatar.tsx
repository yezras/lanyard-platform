/**
 * Shared dither avatar primitives (lp-fn5.3.2 / lp-lv9.8).
 *
 * Deterministic from a seed (avatar_seed / name) so renames do not re-skin.
 * Extracted from DitherAvatarRoster for list rows + chat header reuse.
 *
 * Running motion: when `isRunning`, subtle CSS breathe + pulse ring
 * (see DitherAvatar.css). prefers-reduced-motion disables animation.
 */

import type { CSSProperties, ReactNode } from "react";

import "./DitherAvatar.css";

/** Unsigned 32-bit hash of a seed string/number. */
export function hashSeed(seed: string | number): number {
  const s = String(seed);
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Hue in [0, 360) derived from seed. */
export function hueFromSeed(seed: string | number): number {
  return hashSeed(seed) % 360;
}

/** @deprecated Prefer hueFromSeed; kept for call sites that pass a display name. */
export function hueForName(name: string): number {
  return hueFromSeed(name);
}

export type DitherPatternProps = {
  /** Stable seed for the pixel pattern (avatar_seed or name). */
  seed: string | number;
  hue: number;
};

/**
 * Mirrored 8×8 ordered dither SVG. Pure presentational — parent clips to circle.
 */
export function DitherPattern({ seed, hue }: DitherPatternProps) {
  const size = 8;
  const hash = hashSeed(seed);
  const cells: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < Math.ceil(size / 2); x++) {
      const v = ((hash >> ((x + y * 3) % 24)) & 1) ^ ((x * y) & 1);
      cells.push(v);
    }
  }
  const full: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = x < size / 2 ? x : size - 1 - x;
      const idx = y * Math.ceil(size / 2) + mx;
      full.push(cells[idx] ?? 0);
    }
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      height="100%"
      aria-hidden
      style={{ display: "block" }}
    >
      <rect width={size} height={size} fill={`hsl(${hue} 70% 95%)`} />
      {full.map((v, i) =>
        v ? (
          <rect
            key={i}
            x={i % size}
            y={Math.floor(i / size)}
            width={1}
            height={1}
            fill={`hsl(${hue} 70% 55%)`}
          />
        ) : null,
      )}
    </svg>
  );
}

export type DitherAvatarSize = "sm" | "md" | "lg" | number;

const SIZE_PX: Record<"sm" | "md" | "lg", number> = {
  sm: 20,
  md: 28,
  lg: 36,
};

function resolveSizePx(size: DitherAvatarSize): number {
  return typeof size === "number" ? size : SIZE_PX[size];
}

export type DitherAvatarProps = {
  /** Stable seed (thread avatar_seed preferred over title). */
  seed: string | number;
  size?: DitherAvatarSize;
  /**
   * When true, applies subtle running motion (breathe + pulse ring).
   * Wired from AgentSideNavRow when status is generating / host running.
   * Idle/static when false. CSS honors prefers-reduced-motion.
   */
  isRunning?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Accessible name; decorative when omitted (parent supplies label). */
  label?: string;
  children?: ReactNode;
  "data-testid"?: string;
};

/**
 * Circular dither avatar. Seed-stable: same seed → same hue + pattern.
 */
export function DitherAvatar({
  seed,
  size = "sm",
  isRunning = false,
  className,
  style,
  label,
  children,
  "data-testid": testId,
}: DitherAvatarProps) {
  const hue = hueFromSeed(seed);
  const px = resolveSizePx(size);
  const rootClass = ["dither-avatar-root", className].filter(Boolean).join(" ");
  return (
    <span
      className={rootClass}
      data-testid={testId ?? "dither-avatar"}
      data-avatar-seed={String(seed)}
      data-running={isRunning ? "true" : "false"}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        width: px,
        height: px,
        borderRadius: 999,
        background: `hsl(${hue} 70% 55%)`,
        border: `1px solid hsl(${hue} 70% 45%)`,
        display: "inline-flex",
        /* Visible when running so the pulse ring (inset -2px) is not clipped. */
        overflow: isRunning ? "visible" : "hidden",
        flexShrink: 0,
        position: "relative",
        color: `hsl(${hue} 70% 45%)`,
        ...style,
      }}
    >
      <span
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 999,
          overflow: "hidden",
          display: "block",
        }}
      >
        <DitherPattern seed={seed} hue={hue} />
      </span>
      {isRunning ? (
        <span className="dither-avatar-pulse" aria-hidden data-testid="dither-avatar-pulse" />
      ) : null}
      {children}
    </span>
  );
}
