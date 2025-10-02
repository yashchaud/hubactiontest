"""
Blur Applicator
Applies Gaussian blur to detected regions in video frames
"""

import os
import logging
import asyncio
from typing import List, Dict
import numpy as np
import cv2

logger = logging.getLogger(__name__)


class BlurApplicator:
    """Applies blur to detected regions with smooth transitions"""

    def __init__(self):
        self.kernel_size = int(os.getenv('BLUR_KERNEL_SIZE', 51))
        self.sigma = int(os.getenv('BLUR_SIGMA', 25))

        # Ensure kernel size is odd
        if self.kernel_size % 2 == 0:
            self.kernel_size += 1

        logger.info(
            f"BlurApplicator initialized "
            f"(kernel: {self.kernel_size}, sigma: {self.sigma})"
        )

    def _apply_gaussian_blur(
        self,
        frame: np.ndarray,
        bbox: Dict,
        blur_strength: float = 1.0
    ) -> np.ndarray:
        """Apply Gaussian blur to a specific region"""
        height, width = frame.shape[:2]

        # Extract region coordinates
        x = max(0, bbox['x'])
        y = max(0, bbox['y'])
        x2 = min(width, bbox['x'] + bbox['width'])
        y2 = min(height, bbox['y'] + bbox['height'])

        # Skip if invalid region
        if x >= x2 or y >= y2:
            return frame

        # Extract region
        region = frame[y:y2, x:x2].copy()

        # Apply Gaussian blur
        kernel_size = int(self.kernel_size * blur_strength)
        if kernel_size % 2 == 0:
            kernel_size += 1

        blurred_region = cv2.GaussianBlur(
            region,
            (kernel_size, kernel_size),
            self.sigma * blur_strength
        )

        # Replace region in frame
        frame[y:y2, x:x2] = blurred_region

        return frame

    def _apply_pixelate(
        self,
        frame: np.ndarray,
        bbox: Dict,
        pixel_size: int = 15
    ) -> np.ndarray:
        """Apply pixelation effect to a region (alternative to blur)"""
        height, width = frame.shape[:2]

        x = max(0, bbox['x'])
        y = max(0, bbox['y'])
        x2 = min(width, bbox['x'] + bbox['width'])
        y2 = min(height, bbox['y'] + bbox['height'])

        if x >= x2 or y >= y2:
            return frame

        # Extract region
        region = frame[y:y2, x:x2].copy()

        # Get region dimensions
        region_height, region_width = region.shape[:2]

        # Downsample
        small_region = cv2.resize(
            region,
            (region_width // pixel_size, region_height // pixel_size),
            interpolation=cv2.INTER_LINEAR
        )

        # Upsample back
        pixelated_region = cv2.resize(
            small_region,
            (region_width, region_height),
            interpolation=cv2.INTER_NEAREST
        )

        # Replace region
        frame[y:y2, x:x2] = pixelated_region

        return frame

    def _apply_black_box(
        self,
        frame: np.ndarray,
        bbox: Dict,
        alpha: float = 0.8
    ) -> np.ndarray:
        """Apply semi-transparent black box (alternative censoring method)"""
        height, width = frame.shape[:2]

        x = max(0, bbox['x'])
        y = max(0, bbox['y'])
        x2 = min(width, bbox['x'] + bbox['width'])
        y2 = min(height, bbox['y'] + bbox['height'])

        if x >= x2 or y >= y2:
            return frame

        # Create overlay
        overlay = frame.copy()
        cv2.rectangle(overlay, (x, y), (x2, y2), (0, 0, 0), -1)

        # Blend with original
        frame = cv2.addWeighted(frame, 1 - alpha, overlay, alpha, 0)

        return frame

    def _create_feathered_mask(
        self,
        shape: tuple,
        bbox: Dict,
        feather_amount: int = 10
    ) -> np.ndarray:
        """Create feathered mask for smooth blur transitions"""
        height, width = shape[:2]
        mask = np.zeros((height, width), dtype=np.float32)

        x = max(0, bbox['x'])
        y = max(0, bbox['y'])
        x2 = min(width, bbox['x'] + bbox['width'])
        y2 = min(height, bbox['y'] + bbox['height'])

        if x >= x2 or y >= y2:
            return mask

        # Create solid region
        mask[y:y2, x:x2] = 1.0

        # Apply Gaussian blur to create feathered edges
        if feather_amount > 0:
            mask = cv2.GaussianBlur(mask, (feather_amount * 2 + 1, feather_amount * 2 + 1), 0)

        return mask

    def _merge_overlapping_boxes(self, detections: List[Dict]) -> List[Dict]:
        """Merge overlapping bounding boxes for more efficient blurring"""
        if len(detections) <= 1:
            return detections

        # Sort by x coordinate
        sorted_detections = sorted(detections, key=lambda d: d['bbox']['x'])

        merged = []
        current = sorted_detections[0].copy()

        for detection in sorted_detections[1:]:
            # Check if bounding boxes overlap
            curr_bbox = current['bbox']
            det_bbox = detection['bbox']

            if (curr_bbox['x'] + curr_bbox['width'] >= det_bbox['x'] and
                curr_bbox['y'] + curr_bbox['height'] >= det_bbox['y'] and
                curr_bbox['y'] <= det_bbox['y'] + det_bbox['height']):

                # Merge bounding boxes
                x_min = min(curr_bbox['x'], det_bbox['x'])
                y_min = min(curr_bbox['y'], det_bbox['y'])
                x_max = max(
                    curr_bbox['x'] + curr_bbox['width'],
                    det_bbox['x'] + det_bbox['width']
                )
                y_max = max(
                    curr_bbox['y'] + curr_bbox['height'],
                    det_bbox['y'] + det_bbox['height']
                )

                current['bbox'] = {
                    'x': x_min,
                    'y': y_min,
                    'width': x_max - x_min,
                    'height': y_max - y_min
                }

            else:
                # No overlap, add current and start new
                merged.append(current)
                current = detection.copy()

        merged.append(current)

        logger.debug(f"Merged {len(detections)} boxes into {len(merged)}")

        return merged

    def _get_blur_strength(self, detection: Dict) -> float:
        """Get blur strength based on detection confidence and type"""
        confidence = detection.get('confidence', 1.0)
        censorship_level = detection.get('censorship_level', 'medium')

        # Base strength on confidence
        base_strength = min(confidence * 1.2, 1.0)

        # Adjust based on censorship level
        level_multipliers = {
            'critical': 1.0,
            'high': 0.9,
            'medium': 0.7,
            'low': 0.5
        }

        multiplier = level_multipliers.get(censorship_level, 0.7)

        return base_strength * multiplier

    def _get_blur_method(self, detection: Dict) -> str:
        """Determine blur method based on detection type"""
        detection_type = detection.get('type', 'unknown')
        censorship_level = detection.get('censorship_level', 'medium')

        # Use different methods for different content types
        if censorship_level == 'critical':
            return 'black_box'  # Most aggressive
        elif detection_type == 'text':
            return 'blur'  # Gaussian blur for text
        elif detection_type == 'nsfw':
            return 'pixelate'  # Pixelate for NSFW content
        else:
            return 'blur'  # Default

    async def apply_blur(
        self,
        frame: np.ndarray,
        detections: List[Dict],
        use_feathering: bool = True,
        merge_overlaps: bool = True
    ) -> np.ndarray:
        """
        Apply blur to all detected regions in frame

        Args:
            frame: Input video frame
            detections: List of detections with bounding boxes
            use_feathering: Apply feathered edges for smooth transitions
            merge_overlaps: Merge overlapping bounding boxes

        Returns:
            Blurred frame
        """
        if not detections:
            return frame

        # Filter detections that should be blurred
        blur_detections = [d for d in detections if d.get('should_blur', False)]

        if not blur_detections:
            return frame

        try:
            # Merge overlapping boxes if enabled
            if merge_overlaps:
                blur_detections = self._merge_overlapping_boxes(blur_detections)

            # Work on a copy
            blurred_frame = frame.copy()

            # Apply blur to each detection
            for detection in blur_detections:
                bbox = detection['bbox']
                blur_method = self._get_blur_method(detection)
                blur_strength = self._get_blur_strength(detection)

                if blur_method == 'blur':
                    blurred_frame = self._apply_gaussian_blur(
                        blurred_frame,
                        bbox,
                        blur_strength
                    )
                elif blur_method == 'pixelate':
                    pixel_size = max(5, int(20 * (1 - blur_strength)))
                    blurred_frame = self._apply_pixelate(
                        blurred_frame,
                        bbox,
                        pixel_size
                    )
                elif blur_method == 'black_box':
                    blurred_frame = self._apply_black_box(
                        blurred_frame,
                        bbox,
                        alpha=0.9
                    )

            logger.debug(f"Applied blur to {len(blur_detections)} region(s)")

            return blurred_frame

        except Exception as e:
            logger.error(f"Error applying blur: {e}")
            return frame  # Return original frame on error

    async def apply_blur_batch(
        self,
        frames: List[np.ndarray],
        detections_list: List[List[Dict]]
    ) -> List[np.ndarray]:
        """
        Apply blur to multiple frames in batch

        Args:
            frames: List of video frames
            detections_list: List of detection lists (one per frame)

        Returns:
            List of blurred frames
        """
        if len(frames) != len(detections_list):
            raise ValueError("Number of frames and detection lists must match")

        tasks = [
            self.apply_blur(frame, detections)
            for frame, detections in zip(frames, detections_list)
        ]

        blurred_frames = await asyncio.gather(*tasks)

        return blurred_frames

    def configure(
        self,
        kernel_size: int = None,
        sigma: int = None
    ):
        """Update blur configuration"""
        if kernel_size is not None:
            self.kernel_size = kernel_size if kernel_size % 2 == 1 else kernel_size + 1

        if sigma is not None:
            self.sigma = sigma

        logger.info(f"Blur config updated: kernel={self.kernel_size}, sigma={self.sigma}")
