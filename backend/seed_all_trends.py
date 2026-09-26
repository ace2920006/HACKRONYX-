"""Fast batch seeding of realistic historical observations and seasonal baselines for ALL water bodies."""

from datetime import UTC, datetime, timedelta
import math
import random
import sys
import redis
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.config import get_settings
from app.db.models import (
    Baseline,
    IndicatorObservation,
    Scene,
    WaterBody,
)
from app.db.sync_session import sync_session

STATUS_USABLE = "usable"

INDICATOR_PROFILES = {
    "ndti_turbidity": {
        "base": -0.22,
        "monsoon_delta": 0.16,
        "noise": 0.025,
        "band_width": 0.08,
        "anomaly_factor": 0.18,
    },
    "ndci_chlorophyll": {
        "base": -0.02,
        "monsoon_delta": -0.05,
        "post_monsoon_delta": 0.12,
        "noise": 0.02,
        "band_width": 0.06,
        "anomaly_factor": 0.15,
    },
    "fai_algal": {
        "base": -0.015,
        "monsoon_delta": -0.005,
        "post_monsoon_delta": 0.02,
        "noise": 0.005,
        "band_width": 0.015,
        "anomaly_factor": 0.035,
    },
    "sediment_proxy": {
        "base": 0.04,
        "monsoon_delta": 0.08,
        "noise": 0.015,
        "band_width": 0.04,
        "anomaly_factor": 0.09,
    },
}


def run():
    sys.stdout.reconfigure(line_buffering=True)
    settings = get_settings()
    with sync_session() as s:
        water_bodies = s.scalars(select(WaterBody)).all()
        if not water_bodies:
            print("No water bodies found in database.")
            return

        print(f"Found {len(water_bodies)} water bodies. Batch seeding trends...")

        now = datetime(2026, 9, 26, 5, 30, tzinfo=UTC)
        total_obs = 0
        total_baselines = 0

        scenes_to_insert = []
        obs_to_insert = []
        baselines_to_insert = []

        seen_scenes = set()

        for wb in water_bodies:
            zones = wb.zones
            if not zones:
                continue

            tile = (wb.mgrs_tiles or ["44QKJ"])[0]

            # Generate 25 historical dates across past 300 days
            dates = [now - timedelta(days=i * 12 + random.randint(-2, 2)) for i in range(25)]
            dates.sort()

            for dt in dates:
                dt_str = dt.strftime("%Y%m%d")
                scene_id = f"S2_{tile}_{dt_str}_DEMO"
                if scene_id not in seen_scenes:
                    seen_scenes.add(scene_id)
                    scenes_to_insert.append({
                        "id": scene_id,
                        "mgrs_tile": tile,
                        "sensed_at": dt,
                        "platform": "Sentinel-2B",
                        "cloud_pct": round(random.uniform(2.0, 18.0), 1),
                        "stac_href": "https://earth-search.aws.element84.com/v1",
                        "source": "earth-search",
                        "usable": True,
                        "assets": {},
                        "epsg": 32644,
                    })

            for z_idx, zone in enumerate(zones):
                for ind_name, prof in INDICATOR_PROFILES.items():
                    # Observations
                    for idx, dt in enumerate(dates):
                        doy = dt.timetuple().tm_yday
                        dt_str = dt.strftime("%Y%m%d")
                        scene_id = f"S2_{tile}_{dt_str}_DEMO"

                        monsoon_weight = max(0.0, math.exp(-((doy - 220) ** 2) / (2 * (35 ** 2))))
                        post_monsoon_weight = max(0.0, math.exp(-((doy - 275) ** 2) / (2 * (25 ** 2))))

                        base_val = (
                            prof["base"]
                            + monsoon_weight * prof.get("monsoon_delta", 0.0)
                            + post_monsoon_weight * prof.get("post_monsoon_delta", 0.0)
                        )
                        zone_offset = (z_idx - 1.5) * 0.015

                        noise = random.gauss(0, prof["noise"])
                        obs_val = round(base_val + zone_offset + noise, 4)

                        if z_idx == 0 and idx == len(dates) - 2 and ind_name in ("ndti_turbidity", "ndci_chlorophyll"):
                            obs_val = round(base_val + prof["anomaly_factor"] * 2.2, 4)

                        obs_to_insert.append({
                            "observed_at": dt,
                            "zone_id": zone.id,
                            "indicator": ind_name,
                            "scene_id": scene_id,
                            "water_body_id": wb.id,
                            "mean": obs_val,
                            "p90": round(obs_val + random.uniform(0.01, 0.03), 4),
                            "std": round(prof["noise"], 4),
                            "n_pixels": random.randint(1200, 3500),
                            "valid_pixel_pct": round(random.uniform(75.0, 98.0), 1),
                            "water_fraction_pct": round(random.uniform(85.0, 100.0), 1),
                            "clipped_pct": 0.0,
                        })

                    # Baselines: 366 daily windows
                    for doy_win in range(1, 367):
                        monsoon_weight = max(0.0, math.exp(-((doy_win - 220) ** 2) / (2 * (35 ** 2))))
                        post_monsoon_weight = max(0.0, math.exp(-((doy_win - 275) ** 2) / (2 * (25 ** 2))))
                        b_mean = (
                            prof["base"]
                            + monsoon_weight * prof.get("monsoon_delta", 0.0)
                            + post_monsoon_weight * prof.get("post_monsoon_delta", 0.0)
                        )
                        b_std = prof["noise"] * 1.4826
                        b_p10 = round(b_mean - prof["band_width"] / 2, 4)
                        b_p90 = round(b_mean + prof["band_width"] / 2, 4)

                        baselines_to_insert.append({
                            "zone_id": zone.id,
                            "indicator": ind_name,
                            "doy_window": doy_win,
                            "water_body_id": wb.id,
                            "window_days": 21,
                            "mean": round(b_mean, 4),
                            "std": round(b_std, 4),
                            "p10": b_p10,
                            "p90": b_p90,
                            "n_samples": 18,
                            "n_years": 3,
                            "status": STATUS_USABLE,
                            "history_days": 730,
                        })

        # Batch insert scenes
        if scenes_to_insert:
            stmt = pg_insert(Scene).values(scenes_to_insert).on_conflict_do_nothing()
            s.execute(stmt)
            s.commit()
            print(f"Batch inserted {len(scenes_to_insert)} scenes.")

        # Batch insert observations in chunks of 2,000
        print(f"Inserting {len(obs_to_insert)} observations...")
        for i in range(0, len(obs_to_insert), 2000):
            chunk = obs_to_insert[i:i + 2000]
            stmt = pg_insert(IndicatorObservation).values(chunk).on_conflict_do_nothing()
            s.execute(stmt)
            s.commit()
            total_obs += len(chunk)

        # Batch insert baselines in chunks of 2,000
        print(f"Inserting {len(baselines_to_insert)} baseline windows...")
        for i in range(0, len(baselines_to_insert), 2000):
            chunk = baselines_to_insert[i:i + 2000]
            stmt = pg_insert(Baseline).values(chunk).on_conflict_do_nothing()
            s.execute(stmt)
            s.commit()
            total_baselines += len(chunk)
            if (i // 2000) % 10 == 0:
                print(f"  Baselines progress: {total_baselines}/{len(baselines_to_insert)}")

        # Flush Redis
        try:
            r = redis.from_url(str(settings.redis_url))
            r.flushall()
            print("Flushed Redis series cache.")
        except Exception as e:
            print(f"Redis flush notice: {e}")

        print(f"\n[SUCCESS] All {len(water_bodies)} water bodies now have full 366-day seasonal baselines and 300-day historical trendlines!")


if __name__ == "__main__":
    run()
