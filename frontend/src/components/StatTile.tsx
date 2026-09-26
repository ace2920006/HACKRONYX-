import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * One headline number on the overview. Tone is a *status* signal (reserved for
 * state, never reused as a series colour) and is always carried by the dot plus
 * the wording underneath, never by colour alone.
 */
export type Tone = "neutral" | "good" | "warning" | "critical";

const TONE: Record<Tone, { dot: string; value: string; ring: string }> = {
  neutral: { dot: "bg-slate-400", value: "text-foreground", ring: "ring-slate-200" },
  good:     { dot: "bg-emerald-500", value: "text-foreground", ring: "ring-emerald-100" },
  warning:  { dot: "bg-amber-500", value: "text-amber-700", ring: "ring-amber-100" },
  critical: { dot: "bg-red-500", value: "text-red-600", ring: "ring-red-100" },
};

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  to,
  cta,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  /** When set the whole tile is the button into the screen that explains it. */
  to?: string;
  cta?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full ring-2",
            TONE[tone].dot,
            TONE[tone].ring,
          )}
        />
        <span className="truncate font-medium tracking-wide">{label}</span>
      </div>
      {/* Space Grotesk for the headline metric */}
      <div
        className={cn(
          "mt-2 truncate font-display text-2xl font-bold leading-none tracking-tight",
          TONE[tone].value,
        )}
      >
        {value}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="truncate text-[11px] leading-tight text-muted-foreground" title={sub}>
          {sub}
        </span>
        {to && (
          <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-[#0096C7] opacity-80 transition-opacity group-hover:opacity-100">
            {cta ?? "Open"}
            <ChevronRight className="h-3 w-3" />
          </span>
        )}
      </div>
    </>
  );

  const shell =
    "group min-w-0 rounded-xl border border-[#0096C7]/10 bg-card px-4 py-3 text-left shadow-sm";
  return to ? (
    <Link
      to={to}
      className={cn(
        shell,
        "block transition-all hover:border-[#0096C7]/30 hover:shadow-md hover:shadow-[#0096C7]/8",
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
