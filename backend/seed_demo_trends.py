"""Seed realistic historical observations and seasonal baselines for key water bodies.

This provides rich seasonal trends (p10-p90 band, seasonal median, observed curve,
and anomalies) so the Trends visualization showcases production-grade intelligence.
"""

from datetime import UTC, datetime, timedelta
import math
import random
from sqlalchemy import select
from app.db.sync_session import sync_session
from app.db.models import (
    WaterBody,
    Zone,
    Scene,
    IndicatorObservation,
    Baseline,
)

STATUS_USABLE = "usable"

INDICATOR_PROFILES = {
    "ndti_turbidity": {
        "base": -0.22,
        "monsoon_delta": 0.15,
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

TARGET_BODIES = ["wb_thana_lake", "wb_ambazari_lake", "wb_futala_lake", "wb_venna_dam"]


def run():
    with sync_session() as s:
        water_bodies = s.scalars(select(WaterBody).where(WaterBody.id.in_(TARGET_BODIES))).all()
        if not water_bodies:
            print("No target water bodies found.")
            return

        now = datetime(2026, 9, 26, 5, 30, tzinfo=UTC)
        total_obs = 0
        total_baselines = 0

        for wb in water_bodies:
            print(f"Seeding trends for {wb.id} ({wb.name})...")
            zones = wb.zones
            tile = (wb.mgrs_tiles or ["44QKJ"])[0]

            # Generate 24 historical observation dates across past 300 days (~every 12 days)
            dates = [now - timedelta(days=i * 12 + random.randint(-2, 2)) for i in range(25)]
            dates.sort()

            # Ensure scenes exist for these dates
            for dt in dates:
                dt_str = dt.strftime("%Y%m%d")
                scene_id = f"S2_{tile}_{dt_str}_DEMO"
                existing_scene = s.get(Scene, scene_id)
                if not existing_scene:
                    sc = Scene(
                        id=scene_id,
                        mgrs_tile=tile,
                        sensed_at=dt,
                        platform="Sentinel-2B",
                        cloud_pct=round(random.uniform(2.0, 18.0), 1),
                        stac_href="https://earth-search.aws.element84.com/v1",
                        source="earth-search",
                        usable=True,
                        assets={},
                        epsg=32644,
                    )
                    s.add(sc)
                    s.flush()

            # Populate IndicatorObservations for each zone and indicator
            for z_idx, zone in enumerate(zones):
                for ind_name, prof in INDICATOR_PROFILES.items():
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

                        # Create 1 deliberate anomaly in the second-to-last pass for zone 1 to showcase flagging!
                        if z_idx == 0 and idx == len(dates) - 2 and ind_name == "ndti_turbidity":
                            obs_val = round(base_val + prof["anomaly_factor"] * 2.2, 4)

                        existing = s.scalar(
                            select(IndicatorObservation).where(
                                IndicatorObservation.zone_id == zone.id,
                                IndicatorObservation.indicator == ind_name,
                                IndicatorObservation.observed_at == dt,
                            )
                        )
                        if not existing:
                            obs = IndicatorObservation(
                                observed_at=dt,
                                zone_id=zone.id,
                                indicator=ind_name,
                                scene_id=scene_id,
                                water_body_id=wb.id,
                                mean=obs_val,
                                p90=round(obs_val + random.uniform(0.01, 0.03), 4),
                                std=round(prof["noise"], 4),
                                n_pixels=random.randint(1200, 3500),
                                valid_pixel_pct=round(random.uniform(75.0, 98.0), 1),
                                water_fraction_pct=round(random.uniform(85.0, 100.0), 1),
                                clipped_pct=0.0,
                            )
                            s.add(obs)
                            total_obs += 1

                    # Populate Baseline envelope for day-of-year windows (every 10 DOY)
                    for doy_win in range(1, 366, 7):
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

                        existing_b = s.get(Baseline, (zone.id, ind_name, doy_win))
                        if not existing_b:
                            base_row = Baseline(
                                zone_id=zone.id,
                                indicator=ind_name,
                                doy_window=doy_win,
                                water_body_id=wb.id,
                                window_days=21,
                                mean=round(b_mean, 4),
                                std=round(b_std, 4),
                                p10=b_p10,
                                p90=b_p90,
                                n_samples=18,
                                n_years=3,
                                status=STATUS_USABLE,
                                history_days=730,
                            )
                            s.add(base_row)
                            total_baselines += 1

            s.commit()
            print(f"Successfully populated {wb.id}.")

        print(f"Done! Seeded {total_obs} indicator observations and {total_baselines} baseline windows.")


if __name__ == "__main__":
    run()
