import { useMemo, useState } from "react";
import { format, parseISO, subDays } from "date-fns";
import {
  Activity,
  AlertTriangle,
  ArrowUp,
  Calendar,
  CheckCircle2,
  Droplets,
  Eye,
  Info,
  Layers,
  LineChart as LineChartIcon,
  Play,
  RotateCcw,
  Satellite,
  Sparkles,
  Table2,
} from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSeries, useStartIngest, useWaterBody } from "@/api/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState, PanelSkeleton } from "@/components/States";
import {
  fmtDate,
  fmtNum,
  fmtSigned,
  indicatorLabel,
  indicatorShortLabel,
  QUALITY_INDICATORS,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";

/** Scientific context for each indicator to showcase in the trends dashboard. */
const INDICATOR_DETAILS: Record<
  string,
  {
    name: string;
    description: string;
    normalGuide: string;
    unit: string;
    formula: string;
    statusEval: (v: number) => { label: string; variant: "success" | "warning" | "destructive" };
  }
> = {
  ndti_turbidity: {
    name: "Normalized Difference Turbidity Index",
    description:
      "Measures suspended particulate matter and water clarity using Red (B04) and Green (B03) reflectance bands.",
    normalGuide: "Typical clean freshwater ranges from -0.25 to -0.10. Values above 0 indicate high turbidity or heavy sediment runoff.",
    unit: "NDTI index (-1 to +1)",
    formula: "(B04 - B03) / (B04 + B03)",
    statusEval: (v) => {
      if (v < -0.12) return { label: "Low Turbidity · Clear Water", variant: "success" };
      if (v < 0.02) return { label: "Moderate Turbidity", variant: "warning" };
      return { label: "Elevated Turbidity / Turbid", variant: "destructive" };
    },
  },
  ndci_chlorophyll: {
    name: "Normalized Difference Chlorophyll Index",
    description:
      "Estimates phytoplankton and chlorophyll-a density using Sentinel-2 Red Edge (B05) and Red (B04) bands.",
    normalGuide: "Values below 0 indicate oligotrophic / low algal levels. Values above +0.10 indicate eutrophication and potential bloom conditions.",
    unit: "NDCI index (-1 to +1)",
    formula: "(B05 - B04) / (B05 + B04)",
    statusEval: (v) => {
      if (v < 0.0) return { label: "Low Algae · Normal", variant: "success" };
      if (v < 0.10) return { label: "Moderate Algal Activity", variant: "warning" };
      return { label: "Elevated Chlorophyll-a / Bloom Risk", variant: "destructive" };
    },
  },
  fai_algal: {
    name: "Floating Algae Index",
    description:
      "Detects surface floating vegetation, water hyacinth mats, and cyanobacteria scums by baseline subtraction.",
    normalGuide: "Submerged water bodies stay below 0. Values exceeding +0.02 reveal thick surface plant cover or dense algal mats.",
    unit: "FAI index",
    formula: "B08 - [B04 + (B11 - B04) * (842 - 665) / (1610 - 665)]",
    statusEval: (v) => {
      if (v < 0.0) return { label: "Clear Surface · Normal", variant: "success" };
      if (v < 0.02) return { label: "Sparse Floating Biomass", variant: "warning" };
      return { label: "Dense Surface Algae / Weed Mat", variant: "destructive" };
    },
  },
  sediment_proxy: {
    name: "Suspended Sediment Concentration Proxy",
    description:
      "Calibrated optical backscatter from mineral silt, clay, and soil erosion washed into the reservoir.",
    normalGuide: "Values below 0.06 reflect low particulate runoff. Spikes above 0.12 indicate active upstream monsoon soil erosion.",
    unit: "Reflectance proxy",
    formula: "Calibrated B04 Red reflectance",
    statusEval: (v) => {
      if (v < 0.06) return { label: "Low Suspended Sediment", variant: "success" };
      if (v < 0.12) return { label: "Moderate Silt Load", variant: "warning" };
      return { label: "High Sediment Load", variant: "destructive" };
    },
  },
};

type TimeRangePreset = "30d" | "90d" | "180d" | "365d" | "all";

type Row = {
  t: number;
  date: string;
  value: number | null;
  band: [number, number] | null;
  median: number | null;
  z: number | null;
  flagged: number | null;
  valid_pixel_pct: number | null;
  scene_id: string;
};

export function SeriesChart() {
  const waterBodyId = useUi((s) => s.waterBodyId);
  const zoneId = useUi((s) => s.zoneId);
  const selectedDate = useUi((s) => s.date);
  const indicator = useUi((s) => s.indicator);
  const selectIndicator = useUi((s) => s.selectIndicator);
  const selectDate = useUi((s) => s.selectDate);
  const selectZone = useUi((s) => s.selectZone);
  const watchJob = useUi((s) => s.watchJob);
  const body = useWaterBody(waterBodyId);
  const startIngest = useStartIngest();

  const [timeRange, setTimeRange] = useState<TimeRangePreset>("365d");
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");
  const [showInfo, setShowInfo] = useState<boolean>(false);

  // Derive request window from preset
  const today = useMemo(() => new Date(), []);
  const fromDate = useMemo(() => {
    switch (timeRange) {
      case "30d":
        return format(subDays(today, 30), "yyyy-MM-dd");
      case "90d":
        return format(subDays(today, 90), "yyyy-MM-dd");
      case "180d":
        return format(subDays(today, 180), "yyyy-MM-dd");
      case "365d":
        return format(subDays(today, 365), "yyyy-MM-dd");
      case "all":
        return undefined;
    }
  }, [timeRange, today]);

  const activeZoneId = zoneId ?? body.data?.zones.features[0]?.id ?? undefined;
  const { data, isLoading, error, refetch } = useSeries(
    waterBodyId,
    indicator,
    activeZoneId,
    fromDate,
    undefined,
  );

  // Transform points into recharts rows
  const allRows = useMemo<Row[]>(() => {
    return (data?.points ?? []).map((p) => {
      const isFlagged = p.z_score !== null && p.z_score !== undefined && Math.abs(p.z_score) > 3;
      return {
        t: parseISO(p.observed_at).getTime(),
        date: p.observed_at,
        value: p.value ?? null,
        band:
          p.baseline_p10 !== null &&
          p.baseline_p10 !== undefined &&
          p.baseline_p90 !== null &&
          p.baseline_p90 !== undefined
            ? [p.baseline_p10, p.baseline_p90]
            : null,
        median: p.baseline_mean ?? null,
        z: p.z_score ?? null,
        flagged: isFlagged ? (p.value ?? null) : null,
        valid_pixel_pct: p.valid_pixel_pct ?? null,
        scene_id: p.scene_id,
      };
    });
  }, [data]);

  // Filter rows by timeRange if preset active
  const rows = useMemo(() => {
    if (!fromDate) return allRows;
    const fromTime = parseISO(fromDate).getTime();
    return allRows.filter((r) => r.t >= fromTime);
  }, [allRows, fromDate]);

  // Find currently highlighted observation point
  const currentPoint = useMemo(() => {
    if (!rows.length) return null;
    if (selectedDate) {
      const match = rows.find((r) => r.date.startsWith(selectedDate));
      if (match) return match;
    }
    // Default to latest point
    return rows[rows.length - 1];
  }, [rows, selectedDate]);

  // Compute smart domain that never collapses on 1 point
  const xDomain = useMemo<[number, number]>(() => {
    if (rows.length === 0) {
      const nowMs = Date.now();
      return [nowMs - 30 * 86400000, nowMs];
    }
    const times = rows.map((r) => r.t);
    const minT = Math.min(...times);
    const maxT = Math.max(...times);

    // If only 1 observation or same timestamp: create a comfortable 30-day view
    if (minT === maxT) {
      return [minT - 15 * 86400000, maxT + 15 * 86400000];
    }

    // Pad by 3% on both ends for clean aesthetic margins
    const span = maxT - minT;
    const pad = Math.max(span * 0.035, 2 * 86400000);
    return [minT - pad, maxT + pad];
  }, [rows]);

  const details = INDICATOR_DETAILS[indicator] ?? INDICATOR_DETAILS.ndti_turbidity;
  const activeStatus =
    currentPoint?.value !== null && currentPoint?.value !== undefined
      ? details.statusEval(currentPoint.value)
      : null;

  if (!waterBodyId) return null;

  return (
    <div className="flex h-full flex-col bg-background/50">
      {/* 1. Header Toolbar: Indicators, Time Presets, Zone, & View Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-card/60 px-4 py-2.5 backdrop-blur-xs">
        {/* Indicator Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          {QUALITY_INDICATORS.map((k) => {
            const active = indicator === k;
            return (
              <button
                key={k}
                onClick={() => selectIndicator(k)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all shadow-2xs",
                  active
                    ? "bg-primary text-primary-foreground shadow-xs ring-1 ring-primary/30"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Droplets className={cn("h-3.5 w-3.5", active ? "text-primary-foreground" : "text-primary")} />
                <span>{indicatorShortLabel(k)}</span>
              </button>
            );
          })}
        </div>

        {/* Right tools: Time range, Zones, & View toggle */}
        <div className="flex items-center gap-2">
          {/* Time range presets */}
          <div className="flex items-center rounded-lg border bg-muted/30 p-0.5 text-xs">
            {(["30d", "90d", "180d", "365d", "all"] as TimeRangePreset[]).map((p) => (
              <button
                key={p}
                onClick={() => setTimeRange(p)}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium transition-all",
                  timeRange === p
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p === "365d" ? "1Y" : p.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Zone Selector */}
          {body.data && body.data.zones.features.length > 1 && (
            <div className="flex items-center gap-1 text-xs">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                value={activeZoneId ?? ""}
                onChange={(e) => selectZone(e.target.value || null)}
                className="rounded-md border bg-card px-2 py-1 text-xs font-medium focus:ring-1 focus:ring-primary"
              >
                {body.data.zones.features.map((zf) => (
                  <option key={zf.id} value={zf.id}>
                    {String(zf.properties?.name ?? zf.id)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* View Mode Toggle */}
          <div className="flex items-center rounded-md border bg-muted/40 p-0.5">
            <button
              onClick={() => setViewMode("chart")}
              title="Interactive Chart"
              className={cn(
                "rounded px-2 py-1 text-xs transition-colors",
                viewMode === "chart" ? "bg-card text-foreground shadow-2xs font-medium" : "text-muted-foreground",
              )}
            >
              <LineChartIcon className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("table")}
              title="Pass Table"
              className={cn(
                "rounded px-2 py-1 text-xs transition-colors",
                viewMode === "table" ? "bg-card text-foreground shadow-2xs font-medium" : "text-muted-foreground",
              )}
            >
              <Table2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Scientific Info Button */}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => setShowInfo(!showInfo)}
            title="Scientific methodology & thresholds"
          >
            <Info className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 2. Scientific Info Drawer (Toggleable) */}
      {showInfo && (
        <div className="border-b bg-muted/20 px-4 py-2.5 text-xs animate-in fade-in duration-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="font-semibold text-foreground">{details.name} ({indicatorShortLabel(indicator)})</span>
              <p className="mt-0.5 text-muted-foreground">{details.description}</p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground/80">
                Formula: <span className="text-foreground">{details.formula}</span> · Unit: {details.unit}
              </p>
            </div>
            <div className="rounded-md border bg-card/60 px-3 py-1.5 text-right text-[11px]">
              <span className="font-medium text-foreground">Standard Interpretation</span>
              <p className="mt-0.5 text-muted-foreground">{details.normalGuide}</p>
            </div>
          </div>
        </div>
      )}

      {/* 3. Executive KPI Metric Strip (4 Cards) */}
      <div className="grid grid-cols-2 gap-3 p-4 pb-2 sm:grid-cols-4">
        {/* Card 1: Current Observation */}
        <Card className="bg-card/70 backdrop-blur-xs transition-all hover:border-primary/30">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-muted-foreground text-[11px]">
              <span className="flex items-center gap-1 font-medium">
                <Eye className="h-3.5 w-3.5 text-primary" /> Current Reading
              </span>
              <span>{currentPoint ? fmtDate(currentPoint.date) : "—"}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {currentPoint ? fmtNum(currentPoint.value, 3) : "—"}
              </span>
              <span className="text-xs text-muted-foreground">{details.unit.split(" ")[0]}</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              {activeStatus ? (
                <Badge variant={activeStatus.variant} className="text-[10px] py-0 px-1.5">
                  {activeStatus.label}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">No observation</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Seasonal Normal Baseline */}
        <Card className="bg-card/70 backdrop-blur-xs transition-all hover:border-primary/30">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-muted-foreground text-[11px]">
              <span className="flex items-center gap-1 font-medium">
                <Activity className="h-3.5 w-3.5 text-sky-500" /> Seasonal Normal
              </span>
              <span className="text-sky-600 font-medium">p10–p90 band</span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight text-foreground">
                {currentPoint?.band ? `${fmtNum(currentPoint.band[0], 3)} to ${fmtNum(currentPoint.band[1], 3)}` : "Building..."}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Median: <strong className="text-foreground">{currentPoint ? fmtNum(currentPoint.median, 3) : "—"}</strong></span>
              <span className="flex items-center gap-1">
                <span className={cn("h-1.5 w-1.5 rounded-full", data?.baseline_status === "usable" ? "bg-emerald-500" : "bg-amber-500")} />
                {data?.baseline_status === "usable" ? `${data.baseline_usable_windows} windows` : "Building baseline"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Deviation & Anomaly Z-Score */}
        <Card className="bg-card/70 backdrop-blur-xs transition-all hover:border-primary/30">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-muted-foreground text-[11px]">
              <span className="flex items-center gap-1 font-medium">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Statistical Deviation
              </span>
              <span className="font-mono text-xs">
                z = {currentPoint ? fmtSigned(currentPoint.z, 2) : "0.00"}
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              {currentPoint && currentPoint.z !== null ? (
                Math.abs(currentPoint.z) > 3 ? (
                  <Badge variant="destructive" className="flex items-center gap-1 text-xs py-0.5">
                    <AlertTriangle className="h-3 w-3" /> Flagged Anomaly (|z| &gt; 3)
                  </Badge>
                ) : Math.abs(currentPoint.z) > 2 ? (
                  <Badge variant="warning" className="flex items-center gap-1 text-xs py-0.5">
                    <ArrowUp className="h-3 w-3" /> Warning Level (|z| &gt; 2)
                  </Badge>
                ) : (
                  <Badge variant="success" className="flex items-center gap-1 text-xs py-0.5">
                    <CheckCircle2 className="h-3 w-3" /> Within Normal Bounds
                  </Badge>
                )
              ) : (
                <span className="text-xs text-muted-foreground">Establishing baseline</span>
              )}
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              {currentPoint && currentPoint.value !== null && currentPoint.median !== null ? (
                <span>
                  Deviation:{" "}
                  <strong className={cn(
                    "font-semibold",
                    currentPoint.value > currentPoint.median ? "text-amber-600" : "text-emerald-600"
                  )}>
                    {fmtSigned(((currentPoint.value - currentPoint.median) / Math.abs(currentPoint.median || 1)) * 100, 1)}%
                  </strong>{" "}
                  vs seasonal median
                </span>
              ) : (
                <span>Normal seasonal threshold tracking</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Monitoring Coverage & Actions */}
        <Card className="bg-card/70 backdrop-blur-xs transition-all hover:border-primary/30">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-muted-foreground text-[11px]">
              <span className="flex items-center gap-1 font-medium">
                <Satellite className="h-3.5 w-3.5 text-indigo-500" /> Sentinel-2 Passes
              </span>
              <span>{rows.length} in window</span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight text-foreground">
                {currentPoint?.valid_pixel_pct !== null && currentPoint?.valid_pixel_pct !== undefined
                  ? `${fmtNum(currentPoint.valid_pixel_pct, 1)}%`
                  : "100%"}
              </span>
              <span className="text-xs text-muted-foreground">valid water pixels</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="truncate text-[10px] text-muted-foreground">
                Scene: {currentPoint?.scene_id ? currentPoint.scene_id.slice(0, 18) + "..." : "S2 Pass"}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1 px-2 text-[10px] font-medium"
                disabled={startIngest.isPending}
                onClick={() =>
                  startIngest.mutate(
                    {
                      water_body_id: waterBodyId,
                      date_from: format(subDays(today, 30), "yyyy-MM-dd"),
                      date_to: format(today, "yyyy-MM-dd"),
                      requested_by: "trends_kpi",
                    },
                    { onSuccess: (j) => watchJob(j.job_id) },
                  )
                }
              >
                <Play className="h-2.5 w-2.5 text-primary" /> Run Pass
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 4. Chart / Table Section */}
      <div className="flex-1 min-h-0 px-4 pb-4">
        <Card className="h-full flex flex-col overflow-hidden bg-card/90 shadow-xs border-border/80">
          {/* Legend and Status Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="h-1 w-4 rounded-full bg-blue-600" />
                <span className="text-foreground">Observed Indicator</span>
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="h-0.5 w-4 rounded-full border-t border-dashed border-sky-500" />
                <span>Seasonal Median</span>
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="h-2.5 w-4 rounded-xs bg-sky-400/30 border border-sky-400/40" />
                <span>Normal Band (p10–p90)</span>
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="h-2 w-2 rounded-full bg-red-600 ring-2 ring-red-300" />
                <span>Anomaly (|z| &gt; 3)</span>
              </span>
            </div>

            <div className="text-[11px] text-muted-foreground">
              Click any point to inspect that pass across all maps and indicators
            </div>
          </div>

          {/* Main Visual Content */}
          <div className="flex-1 min-h-0 p-3">
            {isLoading && <PanelSkeleton rows={4} />}
            {error && <ErrorState error={error} onRetry={() => void refetch()} />}

            {/* Empty State */}
            {data && rows.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <Sparkles className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <h4 className="font-semibold text-sm text-foreground">No observations in selected window</h4>
                <p className="mt-1 text-xs text-muted-foreground max-w-sm">
                  Try switching the time range to "1Y" or "All", or run a satellite fetch pass for this water body.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setTimeRange("all")}>
                    <RotateCcw className="h-3 w-3 mr-1" /> View All Time
                  </Button>
                </div>
              </div>
            )}

            {/* Single Observation Callout Banner when only 1 observation is present */}
            {rows.length === 1 && (
              <div className="mb-2 rounded-lg border border-sky-200 bg-sky-50/60 dark:border-sky-950 dark:bg-sky-950/30 p-2.5 text-xs text-sky-900 dark:text-sky-200 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-sky-600 shrink-0" />
                  <span>
                    <strong>Initial observation recorded</strong> for this zone on {fmtDate(rows[0].date)} ({fmtNum(rows[0].value, 3)} {indicatorShortLabel(indicator)}). Full seasonal p10–p90 band model is displayed on the timeline.
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] shrink-0 bg-card hover:bg-accent"
                  onClick={() =>
                    startIngest.mutate(
                      {
                        water_body_id: waterBodyId,
                        date_from: format(subDays(today, 60), "yyyy-MM-dd"),
                        date_to: format(today, "yyyy-MM-dd"),
                        requested_by: "trends_single_callout",
                      },
                      { onSuccess: (j) => watchJob(j.job_id) },
                    )
                  }
                >
                  <Play className="h-2.5 w-2.5 mr-1 text-primary" /> Backfill 60 Days
                </Button>
              </div>
            )}

            {/* CHART VIEW */}
            {viewMode === "chart" && rows.length > 0 && (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 12, right: 24, left: 6, bottom: 6 }}>
                  <defs>
                    {/* Gradient for seasonal normal band */}
                    <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.12} />
                    </linearGradient>

                    {/* Gradient for observed area fill */}
                    <linearGradient id="valGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground) / 0.15)" />

                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={xDomain}
                    scale="time"
                    tickFormatter={(t: number) => format(new Date(t), "d MMM yy")}
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                    dy={4}
                  />

                  <YAxis
                    fontSize={11}
                    width={48}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => fmtNum(v, 2)}
                    tickLine={false}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                  />

                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const r = payload[0]?.payload as Row;
                      if (!r) return null;
                      const rowStatus = r.value !== null ? details.statusEval(r.value) : null;
                      return (
                        <div className="rounded-lg border bg-popover/95 p-3 text-popover-foreground shadow-lg backdrop-blur-md text-xs min-w-[220px]">
                          <div className="flex items-center justify-between border-b pb-1.5 font-semibold text-foreground">
                            <span>{fmtDate(r.date)}</span>
                            {r.flagged !== null ? (
                              <Badge variant="destructive" className="text-[10px] py-0 px-1">
                                Anomaly (|z| &gt; 3)
                              </Badge>
                            ) : (
                              rowStatus && (
                                <Badge variant={rowStatus.variant} className="text-[10px] py-0 px-1">
                                  {rowStatus.label.split("·")[0]}
                                </Badge>
                              )
                            )}
                          </div>

                          <div className="mt-2 space-y-1.5">
                            <div className="flex justify-between items-baseline">
                              <span className="text-muted-foreground">{indicatorLabel(indicator)}:</span>
                              <span className="font-bold text-sm text-primary">
                                {fmtNum(r.value, 4)}
                              </span>
                            </div>

                            {r.median !== null && (
                              <div className="flex justify-between items-baseline">
                                <span className="text-muted-foreground">Seasonal Median:</span>
                                <span className="font-medium text-foreground">{fmtNum(r.median, 4)}</span>
                              </div>
                            )}

                            {r.band && (
                              <div className="flex justify-between items-baseline">
                                <span className="text-muted-foreground">Normal Envelope (p10–p90):</span>
                                <span className="font-medium text-sky-600">
                                  {fmtNum(r.band[0], 3)} to {fmtNum(r.band[1], 3)}
                                </span>
                              </div>
                            )}

                            {r.z !== null && (
                              <div className="flex justify-between items-baseline">
                                <span className="text-muted-foreground">Z-Score:</span>
                                <span className={cn(
                                  "font-mono font-medium",
                                  Math.abs(r.z) > 3 ? "text-red-600" : "text-foreground"
                                )}>
                                  {fmtSigned(r.z, 2)}
                                </span>
                              </div>
                            )}

                            {r.valid_pixel_pct !== null && (
                              <div className="flex justify-between items-baseline pt-1 border-t text-[11px] text-muted-foreground">
                                <span>Valid water area:</span>
                                <span>{fmtNum(r.valid_pixel_pct, 1)}%</span>
                              </div>
                            )}
                          </div>

                          <div className="mt-2 pt-1.5 border-t text-[10px] text-muted-foreground flex justify-between">
                            <span>Scene: {r.scene_id.slice(0, 16)}</span>
                            <span className="text-primary font-medium">Click to select pass</span>
                          </div>
                        </div>
                      );
                    }}
                  />

                  {/* 1. Translucent Seasonal Normal Band (Area) */}
                  <Area
                    dataKey="band"
                    type="monotone"
                    stroke="none"
                    fill="url(#bandGrad)"
                    fillOpacity={1}
                    isAnimationActive={false}
                    connectNulls
                  />

                  {/* 2. Seasonal Median Guideline */}
                  <Line
                    dataKey="median"
                    type="monotone"
                    stroke="#0284c7"
                    strokeWidth={1.75}
                    strokeDasharray="4 4"
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />

                  {/* 3. Observed Value Curve with smooth shading */}
                  <Line
                    dataKey="value"
                    type="monotone"
                    stroke="#2563eb"
                    strokeWidth={2.5}
                    dot={{
                      r: 3.5,
                      fill: "#2563eb",
                      stroke: "#ffffff",
                      strokeWidth: 1.5,
                    }}
                    isAnimationActive={false}
                    connectNulls
                    activeDot={{
                      r: 6.5,
                      fill: "#1d4ed8",
                      stroke: "#ffffff",
                      strokeWidth: 2,
                      onClick: (_e: unknown, p: unknown) => {
                        const payload = (p as { payload?: Row }).payload;
                        if (payload) selectDate(payload.date.slice(0, 10));
                      },
                    }}
                  />

                  {/* 4. Highlighted Anomaly Red Nodes */}
                  <Scatter
                    dataKey="flagged"
                    fill="#ef4444"
                    shape={(props: unknown) => {
                      const { cx, cy } = props as { cx?: number; cy?: number };
                      if (cx === undefined || cy === undefined) return null;
                      return (
                        <g>
                          <circle cx={cx} cy={cy} r={7} fill="#ef4444" fillOpacity={0.3} className="animate-ping" />
                          <circle cx={cx} cy={cy} r={4.5} fill="#ef4444" stroke="#ffffff" strokeWidth={1.5} />
                        </g>
                      );
                    }}
                    isAnimationActive={false}
                  />

                  {/* 5. Highlight Selected Observation Line from Timeline */}
                  {selectedDate && (
                    <ReferenceLine
                      x={parseISO(selectedDate).getTime()}
                      stroke="#4f46e5"
                      strokeWidth={1.75}
                      strokeDasharray="3 3"
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}

            {/* DATA TABLE VIEW */}
            {viewMode === "table" && rows.length > 0 && (
              <div className="h-full overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-muted/90 backdrop-blur-xs text-muted-foreground border-b text-[11px] uppercase tracking-wider font-semibold">
                    <tr>
                      <th className="py-2 px-3">Pass Date</th>
                      <th className="py-2 px-3">Observed Value</th>
                      <th className="py-2 px-3">Seasonal Median</th>
                      <th className="py-2 px-3">Normal Envelope</th>
                      <th className="py-2 px-3">Z-Score</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {rows.map((r) => {
                      const isSelected = selectedDate && r.date.startsWith(selectedDate);
                      const status = r.value !== null ? details.statusEval(r.value) : null;
                      return (
                        <tr
                          key={r.scene_id + r.date}
                          className={cn(
                            "hover:bg-muted/40 transition-colors",
                            isSelected && "bg-primary/10 font-medium",
                          )}
                        >
                          <td className="py-2.5 px-3 flex items-center gap-2">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            {fmtDate(r.date)}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-primary">
                            {fmtNum(r.value, 4)}
                          </td>
                          <td className="py-2.5 px-3 text-muted-foreground">
                            {fmtNum(r.median, 4)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-sky-600 text-[11px]">
                            {r.band ? `[${fmtNum(r.band[0], 3)} – ${fmtNum(r.band[1], 3)}]` : "Building..."}
                          </td>
                          <td className="py-2.5 px-3 font-mono">
                            <span className={cn(
                              Math.abs(r.z || 0) > 3 ? "text-red-600 font-bold" : "text-muted-foreground"
                            )}>
                              {fmtSigned(r.z, 2)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            {r.flagged !== null ? (
                              <Badge variant="destructive" className="text-[10px]">Anomaly</Badge>
                            ) : status ? (
                              <Badge variant={status.variant} className="text-[10px]">
                                {status.label.split("·")[0]}
                              </Badge>
                            ) : null}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <Button
                              size="sm"
                              variant={isSelected ? "default" : "outline"}
                              className="h-6 px-2 text-[11px]"
                              onClick={() => selectDate(r.date.slice(0, 10))}
                            >
                              {isSelected ? "Active" : "Inspect"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
