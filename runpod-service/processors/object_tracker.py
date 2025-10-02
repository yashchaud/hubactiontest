"""
Object Tracking Processor
Uses OpenCV trackers with motion prediction for persistent blur
"""

import os
import logging
import asyncio
from typing import List, Dict, Tuple, Optional
import numpy as np
import cv2
from collections import deque

logger = logging.getLogger(__name__)


class TrackedObject:
    """Represents a tracked object with history"""

    def __init__(self, detection: Dict, tracker, tracking_id: int):
        self.detection = detection
        self.tracker = tracker
        self.tracking_id = tracking_id
        self.age = 0
        self.max_age = int(os.getenv('TRACKER_MAX_AGE', 30))

        # History for velocity calculation
        self.position_history = deque(maxlen=5)
        self.position_history.append(self._get_center())

        # Velocity
        self.velocity = (0.0, 0.0)

    def _get_center(self) -> Tuple[float, float]:
        """Get center point of bounding box"""
        bbox = self.detection['bbox']
        cx = bbox['x'] + bbox['width'] / 2
        cy = bbox['y'] + bbox['height'] / 2
        return (cx, cy)

    def update_position(self, bbox: Dict):
        """Update position and calculate velocity"""
        self.detection['bbox'] = bbox
        center = self._get_center()
        self.position_history.append(center)

        # Calculate velocity from history
        if len(self.position_history) >= 2:
            old_center = self.position_history[0]
            frames = len(self.position_history) - 1

            vx = (center[0] - old_center[0]) / frames
            vy = (center[1] - old_center[1]) / frames

            self.velocity = (vx, vy)
            self.detection['velocity'] = self.velocity

        self.age = 0  # Reset age on successful update

    def predict_position(self, frames_ahead: int = 3) -> Dict:
        """Predict future position based on velocity"""
        vx, vy = self.velocity
        bbox = self.detection['bbox'].copy()

        bbox['x'] = int(bbox['x'] + vx * frames_ahead)
        bbox['y'] = int(bbox['y'] + vy * frames_ahead)

        return bbox

    def increment_age(self):
        """Increment age (frames since last update)"""
        self.age += 1

    def is_expired(self) -> bool:
        """Check if tracker has expired"""
        return self.age > self.max_age


class ObjectTracker:
    """Manages object tracking across video frames"""

    def __init__(self):
        self.tracker_type = os.getenv('TRACKER_TYPE', 'CSRT')
        self.prediction_frames = int(os.getenv('PREDICTION_FRAMES', 3))
        self.next_tracking_id = 0
        logger.info(f"ObjectTracker initialized (type: {self.tracker_type})")

    def _create_tracker(self):
        """Create OpenCV tracker based on configured type"""
        if self.tracker_type == 'CSRT':
            return cv2.TrackerCSRT_create()
        elif self.tracker_type == 'KCF':
            return cv2.TrackerKCF_create()
        elif self.tracker_type == 'MOSSE':
            return cv2.legacy.TrackerMOSSE_create()
        else:
            logger.warning(f"Unknown tracker type: {self.tracker_type}, using CSRT")
            return cv2.TrackerCSRT_create()

    def _bbox_to_tuple(self, bbox: Dict) -> Tuple[int, int, int, int]:
        """Convert bbox dict to tuple for OpenCV"""
        return (bbox['x'], bbox['y'], bbox['width'], bbox['height'])

    def _tuple_to_bbox(self, bbox_tuple: Tuple[int, int, int, int]) -> Dict:
        """Convert tuple to bbox dict"""
        return {
            'x': int(bbox_tuple[0]),
            'y': int(bbox_tuple[1]),
            'width': int(bbox_tuple[2]),
            'height': int(bbox_tuple[3])
        }

    def _calculate_iou(self, bbox1: Dict, bbox2: Dict) -> float:
        """Calculate Intersection over Union (IoU) between two bounding boxes"""
        x1_min = bbox1['x']
        y1_min = bbox1['y']
        x1_max = x1_min + bbox1['width']
        y1_max = y1_min + bbox1['height']

        x2_min = bbox2['x']
        y2_min = bbox2['y']
        x2_max = x2_min + bbox2['width']
        y2_max = y2_min + bbox2['height']

        # Calculate intersection
        x_min = max(x1_min, x2_min)
        y_min = max(y1_min, y2_min)
        x_max = min(x1_max, x2_max)
        y_max = min(y1_max, y2_max)

        if x_max < x_min or y_max < y_min:
            return 0.0

        intersection = (x_max - x_min) * (y_max - y_min)

        # Calculate union
        area1 = bbox1['width'] * bbox1['height']
        area2 = bbox2['width'] * bbox2['height']
        union = area1 + area2 - intersection

        return intersection / union if union > 0 else 0.0

    def _match_detection_to_tracker(
        self,
        detection: Dict,
        trackers: Dict[int, TrackedObject],
        iou_threshold: float = 0.3
    ) -> Optional[int]:
        """Match detection to existing tracker using IoU"""
        best_match_id = None
        best_iou = iou_threshold

        for tracking_id, tracked_obj in trackers.items():
            iou = self._calculate_iou(detection['bbox'], tracked_obj.detection['bbox'])

            if iou > best_iou:
                best_iou = iou
                best_match_id = tracking_id

        return best_match_id

    async def update_trackers(
        self,
        frame: np.ndarray,
        detections: List[Dict],
        trackers: Dict[int, TrackedObject]
    ) -> List[Dict]:
        """
        Update existing trackers and create new ones for detections

        Args:
            frame: Current video frame
            detections: List of new detections from ML models
            trackers: Dictionary of existing tracked objects

        Returns:
            Updated list of detections with tracking IDs and predictions
        """
        try:
            # Update existing trackers
            expired_ids = []

            for tracking_id, tracked_obj in list(trackers.items()):
                success, bbox_tuple = tracked_obj.tracker.update(frame)

                if success:
                    # Update position
                    bbox = self._tuple_to_bbox(bbox_tuple)
                    tracked_obj.update_position(bbox)
                else:
                    # Tracker failed, increment age
                    tracked_obj.increment_age()

                # Check if expired
                if tracked_obj.is_expired():
                    expired_ids.append(tracking_id)

            # Remove expired trackers
            for tracking_id in expired_ids:
                del trackers[tracking_id]
                logger.debug(f"Removed expired tracker: {tracking_id}")

            # Match new detections to existing trackers
            matched_detections = []
            unmatched_detections = []

            for detection in detections:
                match_id = self._match_detection_to_tracker(detection, trackers)

                if match_id is not None:
                    # Update existing tracker
                    tracked_obj = trackers[match_id]
                    tracked_obj.update_position(detection['bbox'])

                    # Use predicted position
                    predicted_bbox = tracked_obj.predict_position(self.prediction_frames)

                    detection['tracking_id'] = match_id
                    detection['bbox'] = predicted_bbox
                    detection['velocity'] = tracked_obj.velocity
                    detection['is_tracked'] = True

                    matched_detections.append(detection)
                else:
                    # New detection, needs tracker
                    unmatched_detections.append(detection)

            # Create trackers for unmatched detections
            for detection in unmatched_detections:
                tracker = self._create_tracker()
                bbox_tuple = self._bbox_to_tuple(detection['bbox'])

                # Initialize tracker
                success = tracker.init(frame, bbox_tuple)

                if success:
                    tracking_id = self.next_tracking_id
                    self.next_tracking_id += 1

                    tracked_obj = TrackedObject(detection, tracker, tracking_id)
                    trackers[tracking_id] = tracked_obj

                    detection['tracking_id'] = tracking_id
                    detection['is_tracked'] = True
                    detection['velocity'] = (0, 0)

                    matched_detections.append(detection)
                    logger.debug(f"Created new tracker: {tracking_id} for {detection['type']}")

            # Add detections from trackers without new detections (persistent blur)
            for tracking_id, tracked_obj in trackers.items():
                # Check if this tracker was matched
                if not any(d.get('tracking_id') == tracking_id for d in matched_detections):
                    # Add predicted position
                    predicted_bbox = tracked_obj.predict_position(self.prediction_frames)

                    persistent_detection = tracked_obj.detection.copy()
                    persistent_detection['bbox'] = predicted_bbox
                    persistent_detection['tracking_id'] = tracking_id
                    persistent_detection['is_tracked'] = True
                    persistent_detection['is_persistent'] = True  # No new detection, just tracking

                    matched_detections.append(persistent_detection)

            logger.debug(
                f"Tracking update: {len(matched_detections)} detections, "
                f"{len(trackers)} active trackers"
            )

            return matched_detections

        except Exception as e:
            logger.error(f"Error in tracker update: {e}")
            return detections  # Return original detections on error

    def clear_trackers(self, trackers: Dict[int, TrackedObject]):
        """Clear all trackers"""
        trackers.clear()
        logger.info("All trackers cleared")

    def get_tracker_count(self, trackers: Dict[int, TrackedObject]) -> int:
        """Get count of active trackers"""
        return len(trackers)

    def get_tracker_stats(self, trackers: Dict[int, TrackedObject]) -> Dict:
        """Get statistics about active trackers"""
        if not trackers:
            return {
                "active_count": 0,
                "average_age": 0,
                "average_velocity": (0, 0)
            }

        ages = [t.age for t in trackers.values()]
        velocities = [t.velocity for t in trackers.values()]

        avg_vx = sum(v[0] for v in velocities) / len(velocities)
        avg_vy = sum(v[1] for v in velocities) / len(velocities)

        return {
            "active_count": len(trackers),
            "average_age": sum(ages) / len(ages),
            "average_velocity": (avg_vx, avg_vy),
            "types": [t.detection['type'] for t in trackers.values()]
        }
