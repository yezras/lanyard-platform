/**
 * Shared connector logo tile for admin list/detail rows (lp-2qs.8.2).
 * Neutral surface + initial — brand color stays in lanyard-theme.css.
 */

export function LogoTile({ label }: { label: string }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 6,
        background: "var(--color-background-muted)",
        color: "var(--color-text-primary)",
        fontWeight: 600,
        fontSize: 13,
      }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}
