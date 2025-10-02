"""
NSFW Detection Processor
Uses NudeNet model for nudity and inappropriate content detection
"""

import os
import logging
import asyncio
from typing import List, Dict
import numpy as np
import cv2

logger = logging.getLogger(__name__)


class NSFWDetector:
    """Detects NSFW content (nudity, explicit imagery) in video frames"""

    def __init__(self):
        self.detector = None
        self._load_model()
        logger.info("NSFWDetector initialized")

    def _load_model(self):
        """Load NudeNet detector model"""
        try:
            from nudenet import NudeDetector

            logger.info("Loading NudeNet detector model...")

            # Initialize NudeNet with default model
            # Will download model automatically on first run
            self.detector = NudeDetector()

            logger.info("NudeNet detector loaded successfully")

        except Exception as e:
            logger.error(f"Error loading NudeNet: {e}")
            logger.warning("NSFW detection will be disabled")
            self.detector = None

    def _filter_by_confidence(
        self,
        detections: List[Dict],
        confidence_threshold: float
    ) -> List[Dict]:
        """Filter detections by confidence threshold"""
        return [
            d for d in detections
            if d.get('score', 0) >= confidence_threshold
        ]

    def _normalize_bbox(self, detection: Dict, frame_shape: tuple, padding: int = 10) -> Dict:
        """Normalize bounding box coordinates"""
        height, width = frame_shape[:2]

        x = max(0, int(detection['box'][0]) - padding)
        y = max(0, int(detection['box'][1]) - padding)
        w = min(width - x, int(detection['box'][2]) + 2 * padding)
        h = min(height - y, int(detection['box'][3]) + 2 * padding)

        return {
            "x": x,
            "y": y,
            "width": w,
            "height": h
        }

    def _get_censorship_level(self, label: str) -> str:
        """Determine censorship level based on detection label"""
        # NudeNet labels: EXPOSED_ANUS, EXPOSED_ARMPITS, COVERED_BELLY, EXPOSED_BELLY,
        # COVERED_BUTTOCKS, EXPOSED_BUTTOCKS, FACE_FEMALE, FACE_MALE, COVERED_FEET,
        # EXPOSED_FEET, COVERED_BREAST_F, EXPOSED_BREAST_F, COVERED_GENITALIA_F,
        # EXPOSED_GENITALIA_F, EXPOSED_BREAST_M, EXPOSED_GENITALIA_M

        high_priority = [
            'EXPOSED_GENITALIA_F',
            'EXPOSED_GENITALIA_M',
            'EXPOSED_BREAST_F',
            'EXPOSED_ANUS'
        ]

        medium_priority = [
            'EXPOSED_BUTTOCKS',
            'EXPOSED_BREAST_M'
        ]

        if label in high_priority:
            return 'critical'
        elif label in medium_priority:
            return 'high'
        else:
            return 'medium'

    async def detect(
        self,
        frame: np.ndarray,
        confidence_threshold: float = 0.85
    ) -> List[Dict]:
        """
        Detect NSFW content in frame

        Args:
            frame: Input video frame (BGR format)
            confidence_threshold: Minimum confidence for detection (0-1)

        Returns:
            List of detection dictionaries with bounding boxes and metadata
        """
        if self.detector is None:
            return []

        try:
            # Convert BGR to RGB for NudeNet
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # Run detection in thread pool (NudeNet is synchronous)
            loop = asyncio.get_event_loop()
            raw_detections = await loop.run_in_executor(
                None,
                self.detector.detect,
                rgb_frame
            )

            # Filter by confidence
            filtered_detections = self._filter_by_confidence(
                raw_detections,
                confidence_threshold
            )

            detections = []
            padding = int(os.getenv('BLUR_PADDING', 10))

            for det in filtered_detections:
                # Normalize bounding box
                bbox = self._normalize_bbox(det, frame.shape, padding)

                # Determine censorship level
                censorship_level = self._get_censorship_level(det['class'])

                detection = {
                    "type": "nsfw",
                    "subtype": det['class'].lower(),
                    "label": det['class'],
                    "confidence": float(det['score']),
                    "bbox": bbox,
                    "should_blur": True,
                    "censorship_level": censorship_level,
                    "tracking_id": None,
                    "velocity": (0, 0)
                }

                detections.append(detection)
                logger.debug(
                    f"NSFW detected: {det['class']} "
                    f"(confidence: {det['score']:.2f}, level: {censorship_level})"
                )

            if detections:
                logger.info(
                    f"NSFW detector found {len(detections)} detection(s) "
                    f"(threshold: {confidence_threshold})"
                )

            return detections

        except Exception as e:
            logger.error(f"Error in NSFW detection: {e}")
            return []

    async def detect_batch(
        self,
        frames: List[np.ndarray],
        confidence_threshold: float = 0.85
    ) -> List[List[Dict]]:
        """
        Detect NSFW content in multiple frames (batch processing)

        Args:
            frames: List of input video frames
            confidence_threshold: Minimum confidence for detection

        Returns:
            List of detection lists (one per frame)
        """
        if self.detector is None:
            return [[] for _ in frames]

        try:
            # Convert all frames to RGB
            rgb_frames = [cv2.cvtColor(f, cv2.COLOR_BGR2RGB) for f in frames]

            # Process all frames in thread pool
            loop = asyncio.get_event_loop()
            tasks = [
                loop.run_in_executor(None, self.detector.detect, frame)
                for frame in rgb_frames
            ]

            raw_results = await asyncio.gather(*tasks)

            # Process results for each frame
            all_detections = []
            padding = int(os.getenv('BLUR_PADDING', 10))

            for frame_idx, raw_detections in enumerate(raw_results):
                filtered = self._filter_by_confidence(raw_detections, confidence_threshold)

                frame_detections = []
                for det in filtered:
                    bbox = self._normalize_bbox(det, frames[frame_idx].shape, padding)
                    censorship_level = self._get_censorship_level(det['class'])

                    detection = {
                        "type": "nsfw",
                        "subtype": det['class'].lower(),
                        "label": det['class'],
                        "confidence": float(det['score']),
                        "bbox": bbox,
                        "should_blur": True,
                        "censorship_level": censorship_level,
                        "tracking_id": None,
                        "velocity": (0, 0)
                    }

                    frame_detections.append(detection)

                all_detections.append(frame_detections)

            logger.info(f"Batch processed {len(frames)} frames")
            return all_detections

        except Exception as e:
            logger.error(f"Error in batch NSFW detection: {e}")
            return [[] for _ in frames]

    def get_supported_labels(self) -> List[str]:
        """Get list of supported detection labels"""
        return [
            'EXPOSED_ANUS',
            'EXPOSED_ARMPITS',
            'COVERED_BELLY',
            'EXPOSED_BELLY',
            'COVERED_BUTTOCKS',
            'EXPOSED_BUTTOCKS',
            'FACE_FEMALE',
            'FACE_MALE',
            'COVERED_FEET',
            'EXPOSED_FEET',
            'COVERED_BREAST_F',
            'EXPOSED_BREAST_F',
            'COVERED_GENITALIA_F',
            'EXPOSED_GENITALIA_F',
            'EXPOSED_BREAST_M',
            'EXPOSED_GENITALIA_M'
        ]
