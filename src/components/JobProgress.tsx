import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Progress for a background job (tracking-number generation, renders, exports).
 *
 * Pass `value` for a determinate bar; omit it for an indeterminate one, which
 * is what a queued job with no known duration gets. Both variants animate only
 * `transform`, so the bar never triggers layout, and the indeterminate sweep
 * falls back to a static sliver when the user prefers reduced motion.
 */
export function JobProgress({
  value,
  label,
  className,
}: {
  /** 0–100. Omit for an indeterminate job. */
  value?: number;
  label?: string;
  className?: string;
}): React.JSX.Element {
  const reduced = useReducedMotion();
  const determinate = typeof value === "number" && Number.isFinite(value);
  const percent = determinate ? Math.min(100, Math.max(0, value)) : undefined;

  return (
    <div className={cn("space-y-1", className)}>
      {label && <p className="text-[11px] text-muted-foreground">{label}</p>}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={percent !== undefined ? `${Math.round(percent)}%` : "In progress"}
        aria-label={label ?? "Job progress"}
        className="h-1 w-full overflow-hidden rounded-full bg-primary/15"
      >
        {percent !== undefined ? (
          <motion.div
            className="h-full w-full origin-left rounded-full bg-primary"
            initial={false}
            animate={{ scaleX: percent / 100 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        ) : reduced ? (
          <div className="h-full w-1/3 rounded-full bg-primary/70" />
        ) : (
          <motion.div
            className="h-full w-1/3 rounded-full bg-primary/70"
            animate={{ x: ["-120%", "320%"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>
    </div>
  );
}
