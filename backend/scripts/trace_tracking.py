"""Trace 30 source seconds at 18 analysis FPS, including actual ByteTrack association costs.

Run from backend with PYTHONPATH=. No database writes; no classifier.
"""

import argparse
import collections
import json
import time
from pathlib import Path

from app.ai.detector.yolo import PersonDetector
from app.ai.tracker.bytetrack import ByteTrackAdapter
from app.monitoring.config import load_runtime_profile_from_paths
from app.monitoring.decoder import VideoDecoder


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--match-thresh", type=float, default=None)
    parser.add_argument("--no-fuse-score", action="store_true")
    args = parser.parse_args()

    p = load_runtime_profile_from_paths(
        config_root=Path("configs"), model_root=Path("../model_artifacts"), profile_name="rtx3060"
    )
    if args.match_thresh is not None:
        p.tracker.match_thresh = args.match_thresh
    if args.no_fuse_score:
        p.tracker.fuse_score = False
    d = PersonDetector(p.detector)
    t = ByteTrackAdapter(p.tracker)
    v = VideoDecoder(args.video)

    def iou(a, b):
        inter = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(
            0, min(a[3], b[3]) - max(a[1], b[1])
        )
        return inter / max(
            1e-9, (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
        )

    costs = {}
    original_get_dists = t._tracker.get_dists

    def get_dists(tracks, detections):
        matrix = original_get_dists(tracks, detections)
        for index, track in enumerate(tracks):
            if len(detections):
                col = int(matrix[index].argmin())
                costs[int(track.track_id)] = {
                    "min_matching_cost": float(matrix[index, col]),
                    "matching_confidence": float(detections[col].score),
                }
        return matrix

    t._tracker.get_dists = get_dists
    prev = {}
    events = []
    counts = collections.Counter()
    started = time.perf_counter()
    for k in range(540):
        packet, _ = v.read_for_timestamp(round(k * 1000 / 18), 0)
        if packet is None:
            break
        costs.clear()
        ds = d.detect(packet.frame)
        tracks = t.update(ds, packet.frame.shape[:2], packet.timestamp_ms)
        active = {x.track_id: x.bbox_xyxy for x in tracks}
        for e in t.drain_lifecycle_events():
            counts[e.event] += 1
            if e.event == "TRACK_LOST":
                box = prev[e.track_id]
                best = max(ds, key=lambda x: iou(box, x.bbox_xyxy), default=None)
                events.append(
                    {
                        **costs.get(e.track_id, {}),
                        "timestamp_ms": packet.timestamp_ms,
                        "track_id": e.track_id,
                        "previous_bbox": box,
                        "detection_count": len(ds),
                        "best_iou": iou(box, best.bbox_xyxy) if best else 0,
                        "best_confidence": best.confidence if best else None,
                        "best_bbox": best.bbox_xyxy if best else None,
                    }
                )
        prev = active
    v.release()
    args.output.write_text(
        json.dumps(
            {
                "source_seconds": 30,
                "analysis_steps": k + 1,
                "elapsed_seconds": time.perf_counter() - started,
                "lifecycle": dict(counts),
                "lost_samples": events,
            },
            indent=2,
        )
    )
    print(dict(counts), len(events))


if __name__ == "__main__":
    main()
