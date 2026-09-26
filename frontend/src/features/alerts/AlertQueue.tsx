import { useState } from "react";
import { CloudRain } from "lucide-react";
import { useAlerts } from "@/api/hooks";
import type { AlertFilters, Severity } from "@/api/types";
import { Disclaimer } from "@/components/Disclaimer";
import { EmptyState, ErrorState, PanelSkeleton } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { fmtDate, fmtKm2, indicatorLabel, severityBg, severityColor, statusLabel } from "@/lib/format";
import { useUi } from "@/store/ui";

/** Priority queue: every alert, priority descending, with server-side filters. */
export function AlertQueue() {
  const [filters, setFilters] = useState<AlertFilters>({ status: "active" });
  const { data, isLoading, error, refetch } = useAlerts({ ...filters, limit: 200 });
  const openAlert = useUi((s) => s.openAlert);

  return (
    <div className="flex h-full flex-col">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[#0096C7]/8 bg-card px-4 py-3 text-xs">
        <label className="flex items-center gap-2 font-medium text-muted-foreground">
          Status
          <select
            className="rounded-xl border border-[#0096C7]/15 bg-card px-2.5 py-1.5 text-foreground transition-colors focus:border-[#0096C7]/40 focus:outline-none"
            value={filters.status ?? "active"}
            onChange={(e) => setFilters({ ...filters, status: e.target.value as AlertFilters["status"] })}
          >
            <option value="active">Open + investigating</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="validated">Validated</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="flex items-center gap-2 font-medium text-muted-foreground">
          Severity
          <select
            className="rounded-xl border border-[#0096C7]/15 bg-card px-2.5 py-1.5 text-foreground transition-colors focus:border-[#0096C7]/40 focus:outline-none"
            value={filters.severity ?? ""}
            onChange={(e) => setFilters({ ...filters, severity: (e.target.value || undefined) as Severity | undefined })}
          >
            <option value="">Any</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="flex items-center gap-2 font-medium text-muted-foreground">
          Min priority
          <input
            type="number"
            min={0}
            max={100}
            className="w-16 rounded-xl border border-[#0096C7]/15 bg-card px-2.5 py-1.5 font-mono text-foreground focus:border-[#0096C7]/40 focus:outline-none"
            value={filters.min_priority ?? ""}
            onChange={(e) =>
              setFilters({ ...filters, min_priority: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          />
        </label>
        <label className="flex items-center gap-2 font-medium text-muted-foreground">
          District
          <input
            className="w-28 rounded-xl border border-[#0096C7]/15 bg-card px-2.5 py-1.5 text-foreground placeholder:text-muted-foreground focus:border-[#0096C7]/40 focus:outline-none"
            placeholder="e.g. Pune"
            value={filters.district ?? ""}
            onChange={(e) => setFilters({ ...filters, district: e.target.value || undefined })}
          />
        </label>
        {data && (
          <span className="ml-auto font-semibold text-muted-foreground">
            <span className="text-foreground">{data.total}</span> alerts
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && <PanelSkeleton rows={8} />}
        {error && <ErrorState error={error} onRetry={() => void refetch()} />}
        {data && data.items.length === 0 && (
          <EmptyState title="No alerts match" hint="Widen the filters, or run the pipeline on a water body." />
        )}
        {data && data.items.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-[#0096C7]/8 text-left">
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Priority</th>
                <th className="py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Water body · zone</th>
                <th className="py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Indicator</th>
                <th className="py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Observed</th>
                <th className="py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Area</th>
                <th className="py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Conf.</th>
                <th className="py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr
                  key={a.alert_id}
                  className="cursor-pointer border-b border-[#0096C7]/5 transition-colors hover:bg-[#0096C7]/5"
                  onClick={() => openAlert(a.alert_id)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full font-mono text-[11px] font-bold text-white shadow-sm"
                        style={{ background: severityColor[a.severity] }}
                      >
                        {Math.round(a.priority_score)}
                      </span>
                      <Badge className={severityBg[a.severity]}>{a.severity}</Badge>
                      {a.natural_cause_likely && <CloudRain className="h-3.5 w-3.5 text-sky-500" aria-label="natural cause likely" />}
                    </div>
                  </td>
                  <td className="py-3">
                    <div className="font-semibold text-foreground">{a.water_body.name}</div>
                    <div className="text-muted-foreground">
                      {a.zone.name} · {a.water_body.district}
                    </div>
                  </td>
                  <td className="py-3">{indicatorLabel(a.primary_indicator)}</td>
                  <td className="py-3">
                    {fmtDate(a.observed_on)}
                    {a.n_observations > 1 && <span className="text-muted-foreground"> ×{a.n_observations}</span>}
                  </td>
                  <td className="py-3 font-mono tabular">{fmtKm2(a.affected_area_km2)}</td>
                  <td className="py-3 font-mono tabular">{a.confidence.toFixed(2)}</td>
                  <td className="py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                      {statusLabel[a.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && <Disclaimer text={data.disclaimer} className="m-2" />}
    </div>
  );
}
