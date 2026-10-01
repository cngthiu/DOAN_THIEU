"""Profile two real monitoring sessions without database writes or browser rendering."""

from __future__ import annotations

import argparse
import json
import logging
import threading
import time
import uuid
from pathlib import Path

from app.ai.cheating_classifier.model import CheatClassifierModel
from app.ai.detector.yolo import DetectorRegistry
from app.monitoring.config import load_runtime_profile_from_paths
from app.monitoring.worker import VideoAnalysisWorker


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=float, default=30)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    root = Path(__file__).resolve().parents[1]
    profile = load_runtime_profile_from_paths(
        config_root=root / "configs",
        model_root=root.parent / "model_artifacts",
        profile_name="rtx3060",
    )
    detectors = DetectorRegistry()
    model = CheatClassifierModel(profile.cheating_classifier, profile.device)
    results = []
    for index in range(2):
        started = time.perf_counter()
        first_tracking, first_behavior = threading.Event(), threading.Event()
        errors: list[str] = []
        rows: list[dict] = []
        timings: dict[str, float] = {}

        def publish(
            message: dict,
            *,
            started=started,
            first_tracking=first_tracking,
            first_behavior=first_behavior,
            errors=errors,
            rows=rows,
            timings=timings,
        ) -> None:
            kind = message["type"]
            elapsed = (time.perf_counter() - started) * 1000
            if kind == "tracking":
                if not first_tracking.is_set():
                    timings["first_tracking_ms"] = elapsed
                    first_tracking.set()
                rows.append(
                    {
                        "timestamp_ms": message["timestamp_ms"],
                        "track_ids": [t["track_id"] for t in message["tracks"]],
                    }
                )
            elif kind == "cheat_prediction":
                timings.setdefault("first_behavior_ms", elapsed)
                first_behavior.set()
            elif kind == "diagnostics":
                for key in ("analysis_fps", "detector_ms", "analysis_lag_ms"):
                    timings[key] = message[key]
            elif kind == "action_error":
                errors.append(message["error"])

        worker = VideoAnalysisWorker(
            session_id=uuid.uuid4(),
            video_path=args.video.resolve(),
            profile=profile,
            start_timestamp_ms=0,
            publish=publish,
            on_ready=lambda: None,
            on_complete=lambda: None,
            on_error=errors.append,
            detector_factory=detectors.create,
            cheat_model=model,
        )
        worker.start()
        try:
            if not first_tracking.wait(30):
                raise RuntimeError(f"No tracking within 30 seconds: {errors}")
            if not first_behavior.wait(180):
                raise RuntimeError(f"No behavior within 180 seconds: {errors}")
            time.sleep(args.seconds)
        finally:
            stopped = worker.stop(timeout=10)
        counts = [len(row["track_ids"]) for row in rows]
        results.append(
            {
                "run": index + 1,
                "timings": timings,
                "tracking_messages": len(rows),
                "min_tracks": min(counts, default=0),
                "max_tracks": max(counts, default=0),
                "distinct_track_ids": sorted({v for r in rows for v in r["track_ids"]}),
                "stopped": stopped,
                "errors": errors,
            }
        )
        args.output.write_text(json.dumps(results, indent=2) + "\n")
        print(json.dumps(results[-1]), flush=True)


if __name__ == "__main__":
    main()
