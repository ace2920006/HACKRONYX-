/**
 * Live Sentinel-2 imagery from Google Earth Engine.
 *
 * `LiveImageryLayer` puts Google-rendered XYZ tiles for the newest pass (or a
 * cloud-free composite) under the pipeline's chip layers; `LiveImageryControls`
 * is the matching block in the layer panel. Both read the same store slice, so
 * the layer follows the selected water body (its bbox) and, when a timeline
 * date is picked, shows the pass on or before that date — otherwise "now".
 *
 * Nothing here is a finding: it is the picture, not the score.
 */
import { TileLayer } from "react-leaflet";
import { Satellite } from "lucide-react";
import { ApiError } from "@/api/http";
import { useImageryStatus, useLiveImagery, useWaterBody } from "@/api/hooks";
import type { LiveImageryQuery, LiveVisKey } from "@/api/types";
import { LIVE_VIS_OPTIONS, MAHARASHTRA_BBOX, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";

/** The query the current UI state maps to, or null while the layer is off. */
function useLiveQuery(): LiveImageryQuery | null {
  const live = useUi((s) => s.live);
  const waterBodyId = useUi((s) => s.waterBodyId);
  const date = useUi((s) => s.date);
  const body = useWaterBody(waterBodyId);
  if (!live.enabled) return null;
  // Wait for the body's bbox rather than flashing the whole-state view first.
  if (waterBodyId && !body.data?.bbox) return null;
  const bbox = body.data?.bbox ?? MAHARASHTRA_BBOX;
  return {
    bbox: bbox.map((v) => v.toFixed(4)).join(","),
    vis: live.vis,
    date: date ?? undefined,
    days: live.days,
    composite: live.composite,
  };
}

export function LiveImageryLayer() {
  const q = useLiveQuery();
  const live = useLiveImagery(q);
  if (!q || !live.data) return null;
  return (
    <TileLayer
      key={live.data.map_id}
      url={live.data.tile_url}
      attribution={live.data.attribution}
      opacity={live.data.vis === "truecolor" || live.data.vis === "falsecolor" ? 1 : 0.85}
      maxNativeZoom={14}
      maxZoom={19}
      zIndex={250}
    />
  );
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503) return "Earth Engine is not configured on the server.";
    if (err.status === 404) return "No cloud-free pass in this window — widen the lookback.";
    return err.message;
  }
  return "Could not load live imagery.";
}

export function LiveImageryControls() {
  const live = useUi((s) => s.live);
  const setLive = useUi((s) => s.setLive);
  const status = useImageryStatus();
  const q = useLiveQuery();
  const result = useLiveImagery(q);
  const offline = status.data ? !status.data.enabled : false;

  return (
    <div className={cn("mt-1.5 border-t pt-1.5", offline && "opacity-60")}>
      <div className="flex items-center justify-between py-0.5">
        <label className="flex cursor-pointer items-center gap-2 font-semibold">
          <input
            type="checkbox"
            checked={live.enabled}
            disabled={offline}
            onChange={(e) => setLive({ enabled: e.target.checked })}
            className="rounded text-primary focus:ring-1 focus:ring-primary"
          />
          <Satellite className="h-3.5 w-3.5 text-indigo-500" />
          <span>Live satellite</span>
        </label>
        {live.enabled && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Active
          </span>
        )}
      </div>

      {offline && (
        <div className="pl-5 text-[10px] text-muted-foreground">
          Earth Engine off on the server (GEE_ENABLED).
        </div>
      )}

      {live.enabled && !offline && (
        <div className="mt-1 space-y-1.5 pl-5">
          <div className="space-y-1">
            {LIVE_VIS_OPTIONS.map((v) => (
              <label key={v.key} className="flex cursor-pointer items-center gap-2 py-0.5 text-xs hover:text-foreground">
                <input
                  type="radio"
                  name="live-vis"
                  checked={live.vis === v.key}
                  onChange={() => setLive({ vis: v.key as LiveVisKey })}
                  className="text-primary focus:ring-1 focus:ring-primary"
                />
                <span className="h-2.5 w-5 shrink-0 rounded-xs border shadow-2xs" style={{ background: v.swatch }} />
                <span className="truncate">{v.label}</span>
              </label>
            ))}
          </div>

          <div className="flex flex-col gap-1 pt-1">
            <select
              className="h-6 w-full min-w-0 rounded border bg-background px-1 text-[11px] font-medium text-foreground focus:ring-1 focus:ring-primary"
              value={live.composite ? "composite" : "latest"}
              onChange={(e) => setLive({ composite: e.target.value === "composite" })}
              aria-label="Live imagery mode"
            >
              <option value="latest">Latest Sentinel-2 pass</option>
              <option value="composite">Cloud-free composite</option>
            </select>
            <select
              className="h-6 w-full min-w-0 rounded border bg-background px-1 text-[11px] text-foreground focus:ring-1 focus:ring-primary"
              value={live.days}
              onChange={(e) => setLive({ days: Number(e.target.value) })}
              aria-label="Lookback window"
            >
              {[15, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  Lookback: last {d} days
                </option>
              ))}
            </select>
          </div>

          <div className="rounded bg-muted/40 p-1 text-[10px] leading-snug text-muted-foreground">
            {result.isPending && q && "Fetching Sentinel-2 stream…"}
            {result.isError && <span className="text-red-700">{errorText(result.error)}</span>}
            {result.data && (
              <div className="space-y-0.5">
                <div className="font-medium text-foreground">
                  {result.data.mode === "composite"
                    ? `Composite of ${result.data.scene_count} passes`
                    : `Pass date: ${fmtDate(result.data.scene_date)}`}
                </div>
                <div>
                  Cloud: {result.data.cloud_pct != null ? `${result.data.cloud_pct.toFixed(0)}%` : "<5%"} · High-res stream
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
