"""
Text Detection Processor
Uses Keras-OCR for text detection and profanity matching for filtering
"""

import os
import logging
import asyncio
from typing import List, Dict, Tuple
import numpy as np
import cv2

logger = logging.getLogger(__name__)


class TextDetector:
    """Detects text in video frames and filters profanity"""

    def __init__(self):
        self.pipeline = None
        self.profanity_cache = set()
        self._load_model()
        logger.info("TextDetector initialized")

    def _load_model(self):
        """Load Keras-OCR pipeline"""
        try:
            import keras_ocr

            # Initialize Keras-OCR pipeline with GPU support
            logger.info("Loading Keras-OCR pipeline (this may take a minute)...")
            self.pipeline = keras_ocr.pipeline.Pipeline()
            logger.info("Keras-OCR pipeline loaded successfully")

        except Exception as e:
            logger.error(f"Error loading Keras-OCR: {e}")
            logger.warning("Text detection will be disabled")
            self.pipeline = None

    def _normalize_text(self, text: str) -> str:
        """Normalize text for comparison"""
        # Remove special characters, convert to lowercase, remove spaces
        normalized = ''.join(c.lower() for c in text if c.isalnum())
        return normalized

    def _is_profanity(self, text: str, profanity_list: List[str]) -> Tuple[bool, str]:
        """Check if text contains profanity"""
        normalized_text = self._normalize_text(text)

        # Check against profanity list
        for profane_word in profanity_list:
            normalized_profane = self._normalize_text(profane_word)
            if normalized_profane in normalized_text:
                return True, profane_word

        return False, ""

    def _calculate_bounding_box(self, box: np.ndarray, padding: int = 10) -> Dict:
        """Calculate bounding box from Keras-OCR box coordinates"""
        # Keras-OCR returns box as [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
        x_coords = box[:, 0]
        y_coords = box[:, 1]

        x_min = int(np.min(x_coords)) - padding
        y_min = int(np.min(y_coords)) - padding
        x_max = int(np.max(x_coords)) + padding
        y_max = int(np.max(y_coords)) + padding

        return {
            "x": max(0, x_min),
            "y": max(0, y_min),
            "width": x_max - x_min,
            "height": y_max - y_min
        }

    def _predict_position(
        self,
        current_box: Dict,
        velocity: Tuple[float, float],
        frames_ahead: int = 3
    ) -> Dict:
        """Predict future position based on velocity"""
        vx, vy = velocity

        predicted_box = {
            "x": int(current_box["x"] + vx * frames_ahead),
            "y": int(current_box["y"] + vy * frames_ahead),
            "width": current_box["width"],
            "height": current_box["height"]
        }

        return predicted_box

    async def detect(
        self,
        frame: np.ndarray,
        confidence_threshold: float = 0.7,
        profanity_list: List[str] = None
    ) -> List[Dict]:
        """
        Detect text in frame and filter for profanity

        Args:
            frame: Input video frame (BGR format)
            confidence_threshold: Minimum confidence for detection
            profanity_list: List of profane words to detect

        Returns:
            List of detection dictionaries with bounding boxes and metadata
        """
        if self.pipeline is None:
            return []

        if profanity_list is None:
            profanity_list = []

        try:
            # Convert BGR to RGB for Keras-OCR
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # Run OCR in thread pool (Keras-OCR is synchronous)
            loop = asyncio.get_event_loop()
            predictions = await loop.run_in_executor(
                None,
                self.pipeline.recognize,
                [rgb_frame]
            )

            # predictions is a list of lists: [[(text, box), ...]]
            frame_predictions = predictions[0] if predictions else []

            detections = []
            padding = int(os.getenv('BLUR_PADDING', 10))

            for text, box in frame_predictions:
                # Check if text contains profanity
                is_profane, matched_word = self._is_profanity(text, profanity_list)

                if is_profane:
                    # Calculate bounding box
                    bbox = self._calculate_bounding_box(box, padding)

                    detection = {
                        "type": "text",
                        "subtype": "profanity",
                        "text": text,
                        "matched_word": matched_word,
                        "confidence": 1.0,  # Keras-OCR doesn't provide confidence
                        "bbox": bbox,
                        "should_blur": True,
                        "tracking_id": None,  # Will be assigned by tracker
                        "velocity": (0, 0)  # Will be updated by tracker
                    }

                    detections.append(detection)
                    logger.debug(f"Profanity detected: '{text}' (matched: {matched_word})")

            if detections:
                logger.info(f"Text detector found {len(detections)} profane text(s)")

            return detections

        except Exception as e:
            logger.error(f"Error in text detection: {e}")
            return []

    async def detect_with_context(
        self,
        frame: np.ndarray,
        profanity_list: List[str] = None,
        context_window: int = 5
    ) -> List[Dict]:
        """
        Detect text with context analysis (e.g., medical terms vs profanity)

        Args:
            frame: Input video frame
            profanity_list: List of profane words
            context_window: Number of surrounding words to consider

        Returns:
            List of detections with context awareness
        """
        # Run basic detection
        detections = await self.detect(frame, profanity_list=profanity_list)

        # TODO: Implement context analysis using NLP
        # For now, return basic detections
        return detections

    def preload_profanity_list(self, profanity_list: List[str]):
        """Preload profanity list into cache for faster lookups"""
        self.profanity_cache = set(self._normalize_text(word) for word in profanity_list)
        logger.info(f"Preloaded {len(self.profanity_cache)} profane words into cache")
