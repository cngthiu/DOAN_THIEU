from __future__ import annotations

import uuid
from dataclasses import dataclass
from types import SimpleNamespace

import numpy as np
from ultralytics.engine.results import Boxes
from ultralytics.trackers.byte_tracker import BYTETracker

from app.ai.domain import Detection, TrackedObject
from app.monitoring.config import ByteTrackConfig


@dataclass(frozen=True, slots=True)
class TrackLifecycleEvent:
    event: str
    track_id: int


def _bbox_iou(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> float:
    intersection_width = max(0.0, min(left[2], right[2]) - max(left[0], right[0]))
    intersection_height = max(0.0, min(left[3], right[3]) - max(left[1], right[1]))
    intersection = intersection_width * intersection_height
    left_area = max(0.0, left[2] - left[0]) * max(0.0, left[3] - left[1])
    right_area = max(0.0, right[2] - right[0]) * max(0.0, right[3] - right[1])
    union = left_area + right_area - intersection
    return intersection / union if union > 0 else 0.0


def _same_person_region(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> bool:
    """Recognize a full-body/torso hand-off as the same image region.

    A torso detection can be almost completely inside the previous full-body
    track while their IoU stays below the normal association gate. Treating
    containment as overlap prevents the lost full-body prediction and the new
    torso track from being published together.
    """
    intersection_width = max(0.0, min(left[2], right[2]) - max(left[0], right[0]))
    intersection_height = max(0.0, min(left[3], right[3]) - max(left[1], right[1]))
    intersection = intersection_width * intersection_height
    left_area = max(0.0, left[2] - left[0]) * max(0.0, left[3] - left[1])
    right_area = max(0.0, right[2] - right[0]) * max(0.0, right[3] - right[1])
    smaller_area = min(left_area, right_area)
    containment = intersection / smaller_area if smaller_area > 0 else 0.0
    return _bbox_iou(left, right) >= 0.30 or containment >= 0.80


class ByteTrackAdapter:
    def __init__(self, config: ByteTrackConfig) -> None:
        self.config = config
        self.instance_id = uuid.uuid4()
        self._tracker = BYTETracker(SimpleNamespace(**config.model_dump()))
        self._active_ids: set[int] = set()
        self._seen_ids: set[int] = set()
        self._reported_removed_ids: set[int] = set()
        self._lifecycle_events: list[TrackLifecycleEvent] = []
        self._last_timestamp_ms: int | None = None
        self._last_observed_ms: dict[int, int] = {}
        self._last_confidence: dict[int, float] = {}
        self._last_bbox: dict[int, tuple[float, float, float, float]] = {}

    def update(
        self,
        detections: list[Detection],
        frame_shape: tuple[int, int],
        timestamp_ms: int,
    ) -> list[TrackedObject]:
        if self._last_timestamp_ms is not None and timestamp_ms <= self._last_timestamp_ms:
            raise ValueError(
                "ByteTrack input timestamp must increase within one runtime generation"
            )
        self._last_timestamp_ms = timestamp_ms
        rows = np.asarray(
            [
                [*detection.bbox_xyxy, detection.confidence, detection.class_id]
                for detection in detections
            ],
            dtype=np.float32,
        ).reshape((-1, 6))
        results = self._tracker.update(Boxes(rows, orig_shape=frame_shape))
        observed = [
            TrackedObject(
                track_id=int(row[4]),
                bbox_xyxy=tuple(float(value) for value in row[:4]),  # type: ignore[arg-type]
                confidence=float(row[5]),
            )
            for row in results
        ]
        current_ids = {item.track_id for item in observed}
        for item in observed:
            self._last_observed_ms[item.track_id] = timestamp_ms
            self._last_confidence[item.track_id] = item.confidence
            self._last_bbox[item.track_id] = item.bbox_xyxy

        # Ultralytics intentionally omits lost tracks from `results`, although
        # ByteTrack still owns their Kalman state in `lost_stracks`. Publishing
        # the short-lived prediction prevents a single missed YOLO frame from
        # becoming an empty tracking frame. A current observation always wins,
        # and an overlapping new ID suppresses the old prediction to avoid two
        # boxes around one person after a genuine tracker hand-off.
        predicted: list[TrackedObject] = []
        if self.config.lost_track_hold_ms:
            observed_boxes = [item.bbox_xyxy for item in observed]
            lost_tracks = sorted(
                getattr(self._tracker, "lost_stracks", ()),
                key=lambda item: (
                    self._last_observed_ms.get(int(item.track_id), -1),
                    self._last_confidence.get(int(item.track_id), 0.0),
                ),
                reverse=True,
            )
            for track in lost_tracks:
                track_id = int(track.track_id)
                last_seen = self._last_observed_ms.get(track_id)
                if last_seen is None or timestamp_ms - last_seen > self.config.lost_track_hold_ms:
                    continue
                # Keep the last observed box instead of exposing an unchecked
                # Kalman extrapolation. In static exam scenes the extrapolated
                # box can drift across an empty desk for several seconds.
                bbox = self._last_bbox.get(track_id)
                if bbox is None:
                    continue
                if any(_same_person_region(bbox, current) for current in observed_boxes):
                    continue
                if any(_same_person_region(bbox, item.bbox_xyxy) for item in predicted):
                    continue
                predicted.append(
                    TrackedObject(
                        track_id=track_id,
                        bbox_xyxy=bbox,  # type: ignore[arg-type]
                        confidence=self._last_confidence.get(track_id, float(track.score)),
                        predicted=True,
                    )
                )
        removed_ids = {
            int(item.track_id)
            for item in getattr(self._tracker, "removed_stracks", ())
            if getattr(item, "track_id", None) is not None
        }
        for track_id in sorted(current_ids - self._seen_ids):
            self._lifecycle_events.append(TrackLifecycleEvent("TRACK_CREATED", track_id))
        for track_id in sorted(current_ids & self._seen_ids):
            self._lifecycle_events.append(TrackLifecycleEvent("TRACK_UPDATED", track_id))
        for track_id in sorted((self._active_ids - current_ids) - removed_ids):
            self._lifecycle_events.append(TrackLifecycleEvent("TRACK_LOST", track_id))
        for track_id in sorted(removed_ids - self._reported_removed_ids):
            self._lifecycle_events.append(TrackLifecycleEvent("TRACK_REMOVED", track_id))
        self._active_ids = current_ids
        self._seen_ids.update(current_ids)
        self._reported_removed_ids.update(removed_ids)
        for track_id in removed_ids:
            self._last_observed_ms.pop(track_id, None)
            self._last_confidence.pop(track_id, None)
            self._last_bbox.pop(track_id, None)
        return observed + predicted

    def debug_snapshot(self, track_ids: set[int], limit: int) -> list[dict[str, object]]:
        rows: list[dict[str, object]] = []
        for state, tracks in (
            ("Tracked", self._tracker.tracked_stracks),
            ("Lost", self._tracker.lost_stracks),
            ("Removed", self._tracker.removed_stracks),
        ):
            for track in tracks:
                if track_ids and int(track.track_id) not in track_ids:
                    continue
                rows.append(
                    {
                        "track_id": int(track.track_id),
                        "state": state,
                        "bbox": [round(float(v), 2) for v in track.xyxy],
                        "confidence": float(track.score),
                        "lost_updates": self._tracker.frame_id - track.end_frame,
                    }
                )
                if len(rows) >= limit:
                    return rows
        return rows

    def drain_lifecycle_events(self) -> tuple[TrackLifecycleEvent, ...]:
        events = tuple(self._lifecycle_events)
        self._lifecycle_events.clear()
        return events

    def reset(self) -> None:
        self._tracker.reset()
        self._active_ids.clear()
        self._seen_ids.clear()
        self._reported_removed_ids.clear()
        self._lifecycle_events.clear()
        self._last_timestamp_ms = None
        self._last_observed_ms.clear()
        self._last_confidence.clear()
        self._last_bbox.clear()
