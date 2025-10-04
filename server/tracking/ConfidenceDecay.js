/**
 * Confidence Decay System
 *
 * Implements temporal smoothing with exponential confidence decay:
 * - Prevents blur flicker/flashing
 * - Keeps blur active for 10-15 frames after last detection
 * - Graceful fade-out when object leaves frame
 *
 * Based on industry best practices from video segmentation/tracking systems
 */

export class ConfidenceDecay {
  constructor(options = {}) {
    this.decayRate = options.decayRate || 0.85;  // Per-frame decay (0.85 = ~15 frames to min)
    this.minConfidence = options.minConfidence || 0.3;  // Threshold for removal
    this.dilationPx = options.dilationPx || 8;  // Safety margin around bbox

    this.regions = new Map();  // regionId -> region data
    this.nextRegionId = 1;

    console.log(`[ConfidenceDecay] Initialized: decayRate=${this.decayRate}, minConf=${this.minConfidence}, dilation=${this.dilationPx}px`);
  }

  /**
   * Add or update region with detection
   * @param {Object} detection - Detection with bbox and confidence
   * @param {number} trackerId - Optional tracker ID for association
   * @returns {number} regionId
   */
  update(detection, trackerId = null) {
    const bbox = detection.bbox || detection;

    // Find existing region by trackerId or bbox overlap
    let regionId = null;

    if (trackerId !== null) {
      // Find region by tracker ID
      for (const [id, region] of this.regions.entries()) {
        if (region.trackerId === trackerId) {
          regionId = id;
          break;
        }
      }
    }

    if (regionId === null) {
      // Find by bbox overlap (IoU > 0.3)
      for (const [id, region] of this.regions.entries()) {
        if (this._calculateIoU(bbox, region.bbox) > 0.3) {
          regionId = id;
          break;
        }
      }
    }

    // Create new region if not found
    if (regionId === null) {
      regionId = this.nextRegionId++;
    }

    // Update or create region
    this.regions.set(regionId, {
      bbox: { ...bbox },
      confidence: 1.0,  // Reset to full confidence
      lastSeen: Date.now(),
      framesSinceUpdate: 0,
      trackerId,
      label: detection.label || 'unknown',
      type: detection.type || 'nsfw'
    });

    return regionId;
  }

  /**
   * Decay all regions (call once per frame)
   * @returns {Map} regionId -> region data (only active regions)
   */
  decay() {
    const activeRegions = new Map();

    for (const [regionId, region] of this.regions.entries()) {
      region.framesSinceUpdate++;

      // Apply exponential decay
      region.confidence *= this.decayRate;

      // Keep region if confidence above threshold
      if (region.confidence >= this.minConfidence) {
        // Apply dilation for safety margin
        const dilatedBbox = this._dilateBbox(region.bbox, this.dilationPx);

        activeRegions.set(regionId, {
          ...region,
          bbox: dilatedBbox,
          shouldBlur: true
        });
      } else {
        // Remove region (confidence too low)
        console.log(`[ConfidenceDecay] Removing region ${regionId} (confidence: ${region.confidence.toFixed(2)})`);
      }
    }

    // Update regions map
    this.regions = activeRegions;

    return activeRegions;
  }

  /**
   * Get all active blur regions
   * @returns {Array} Array of blur regions with dilated bboxes
   */
  getBlurRegions() {
    return Array.from(this.regions.values()).map(region => ({
      bbox: region.bbox,
      confidence: region.confidence,
      label: region.label,
      type: region.type,
      shouldBlur: true
    }));
  }

  /**
   * Force remove region
   * @param {number} regionId
   */
  remove(regionId) {
    if (this.regions.delete(regionId)) {
      console.log(`[ConfidenceDecay] Removed region ${regionId}`);
    }
  }

  /**
   * Remove region by tracker ID
   * @param {number} trackerId
   */
  removeByTracker(trackerId) {
    for (const [regionId, region] of this.regions.entries()) {
      if (region.trackerId === trackerId) {
        this.remove(regionId);
        return;
      }
    }
  }

  /**
   * Clear all regions
   */
  clear() {
    this.regions.clear();
    console.log(`[ConfidenceDecay] Cleared all regions`);
  }

  /**
   * Calculate Intersection over Union (IoU) between two bboxes
   * @private
   */
  _calculateIoU(bbox1, bbox2) {
    const x1 = Math.max(bbox1.x, bbox2.x);
    const y1 = Math.max(bbox1.y, bbox2.y);
    const x2 = Math.min(bbox1.x + bbox1.width, bbox2.x + bbox2.width);
    const y2 = Math.min(bbox1.y + bbox1.height, bbox2.y + bbox2.height);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const area1 = bbox1.width * bbox1.height;
    const area2 = bbox2.width * bbox2.height;
    const union = area1 + area2 - intersection;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Dilate bounding box by margin (safety padding)
   * @private
   */
  _dilateBbox(bbox, margin) {
    return {
      x: Math.max(0, bbox.x - margin),
      y: Math.max(0, bbox.y - margin),
      width: bbox.width + 2 * margin,
      height: bbox.height + 2 * margin
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    const regions = Array.from(this.regions.values());
    return {
      activeRegions: this.regions.size,
      avgConfidence: regions.length > 0
        ? regions.reduce((sum, r) => sum + r.confidence, 0) / regions.length
        : 0,
      regions: regions.map(r => ({
        confidence: r.confidence,
        framesSinceUpdate: r.framesSinceUpdate,
        age: Date.now() - r.lastSeen
      }))
    };
  }
}

export default ConfidenceDecay;
