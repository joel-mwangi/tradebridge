"use client";

import styles from "./Skeleton.module.css";

type Size = "xs" | "sm" | "md" | "lg" | "xl" | "btn";
type Width = "w25" | "w40" | "w55" | "w70" | "w85" | "full";

export function Skeleton({
  size = "md",
  width = "full",
  pill = false,
  circle = false,
  style,
}: {
  size?: Size;
  width?: Width;
  pill?: boolean;
  circle?: boolean;
  style?: React.CSSProperties;
}) {
  const classes = [
    styles.block,
    styles[size],
    styles[width],
    pill ? styles.pill : "",
    circle ? styles.circle : "",
  ]
    .filter(Boolean)
    .join(" ");
  return <span aria-hidden="true" className={classes} style={style} />;
}

/** A labelled row: label on the left, wider value skeleton on the right. */
export function SkeletonRow({ gap = 6 }: { gap?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      <Skeleton size="xs" width="w40" />
      <Skeleton size="lg" width="w70" />
    </div>
  );
}

/** A card-shaped skeleton panel. */
export function SkeletonCard({ rows = 3, style }: { rows?: number; style?: React.CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: 16,
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        ...style,
      }}
    >
      <Skeleton size="sm" width="w55" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} size={i === 0 ? "lg" : "sm"} width={i % 2 === 0 ? "w85" : "w70"} />
      ))}
    </div>
  );
}
