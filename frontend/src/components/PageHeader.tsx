import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "react-router-dom";

/** Header for a drill-down screen: a way back, what you are looking at, controls. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-[#0096C7]/8 bg-card px-4 py-3">
      <Link
        to="/"
        className="flex shrink-0 items-center gap-1 rounded-xl border border-[#0096C7]/15 px-3 py-1.5 text-xs text-muted-foreground transition-all hover:border-[#0096C7]/30 hover:bg-[#0096C7]/5 hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Overview
      </Link>
      <div className="min-w-0 leading-tight">
        <div className="truncate font-display text-sm font-bold tracking-tight text-foreground">
          {title}
        </div>
        {subtitle && (
          <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
        )}
      </div>
      {actions && (
        <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
