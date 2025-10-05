/**
 * Kalman Filter Object Tracker
 *
 * Implements 8-dimensional state space Kalman filter for bounding box tracking:
 * State: [x, y, aspect_ratio, height, vx, vy, va, vh]
 *
 * Based on research:
 * - "Real-Time Object Tracking Using YOLOv5, Kalman Filter & Hungarian Algorithm" (2024)
 * - OMCTrack (ECCV 2024) - 96.8% accuracy
 *
 * Features:
 * - Constant velocity model
 * - Predict/update cycle
 * - Multi-object tracking support
 * - Motion-based confidence scoring
 */

import KalmanFilter from 'kalman-filter';

export class KalmanTracker {
  constructor(options = {}) {
    this.processNoise = options.processNoise || 0.01;
    this.measurementNoise = options.measurementNoise || 0.1;
    this.trackers = new Map();  // trackerId -> tracker
    this.nextTrackerId = 1;

    console.log(`[KalmanTracker] Initialized with processNoise=${this.processNoise}, measurementNoise=${this.measurementNoise}`);
  }

  /**
   * Initialize tracker for new detection
   * @param {Object} detection - Detection with bbox: {x, y, width, height}
   * @returns {number} trackerId
   */
  initTracker(detection) {
    const { x, y, width, height } = detection.bbox || detection;

    // Calculate aspect ratio
    const aspectRatio = width / height;

    // Initial state: [x, y, aspect, height, vx, vy, va, vh]
    const initialState = [
      x + width / 2,  // Center x
      y + height / 2, // Center y
      aspectRatio,
      height,
      0,  // vx (velocity x)
      0,  // vy (velocity y)
      0,  // va (aspect velocity)
      0   // vh (height velocity)
    ];

    // State transition matrix (constant velocity model)
    const stateTransition = [
      [1, 0, 0, 0, 1, 0, 0, 0],  // x' = x + vx
      [0, 1, 0, 0, 0, 1, 0, 0],  // y' = y + vy
      [0, 0, 1, 0, 0, 0, 1, 0],  // a' = a + va
      [0, 0, 0, 1, 0, 0, 0, 1],  // h' = h + vh
      [0, 0, 0, 0, 1, 0, 0, 0],  // vx' = vx
      [0, 0, 0, 0, 0, 1, 0, 0],  // vy' = vy
      [0, 0, 0, 0, 0, 0, 1, 0],  // va' = va
      [0, 0, 0, 0, 0, 0, 0, 1]   // vh' = vh
    ];

    // Observation matrix (we measure x, y, aspect, height)
    const observation = [
      [1, 0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0, 0]
    ];

    const kf = new KalmanFilter({
      observation: {
        dimension: 4,
        stateProjection: observation
      },
      dynamic: {
        dimension: 8,
        transition: stateTransition,
        init: {
          mean: initialState,
          covariance: Array(8).fill(0).map((_, i) =>
            Array(8).fill(0).map((__, j) => i === j ? 1 : 0)
          )
        },
        covariance: Array(8).fill(0).map((_, i) =>
          Array(8).fill(0).map((__, j) => i === j ? this.processNoise : 0)
        )
      }
    });

    const trackerId = this.nextTrackerId++;
    this.trackers.set(trackerId, {
      kf,
      lastUpdate: Date.now(),
      missCount: 0,
      hitCount: 1,
      state: initialState,
      detection
    });

    console.log(`[KalmanTracker] Initialized tracker ${trackerId} at (${x}, ${y}, ${width}, ${height})`);
    return trackerId;
  }

  /**
   * Predict next state for tracker
   * @param {number} trackerId
   * @returns {Object} Predicted bbox: {x, y, width, height}
   */
  predict(trackerId) {
    const tracker = this.trackers.get(trackerId);
    if (!tracker) {
      throw new Error(`Tracker ${trackerId} not found`);
    }

    // Predict next state
    const predicted = tracker.kf.predict();
    tracker.state = predicted.mean;

    // Convert state to bbox
    const [cx, cy, aspect, height] = predicted.mean;
    const width = aspect * height;

    return {
      x: Math.round(cx - width / 2),
      y: Math.round(cy - height / 2),
      width: Math.round(width),
      height: Math.round(height),
      confidence: this._calculateConfidence(tracker)
    };
  }

  /**
   * Predict all active trackers
   * @returns {Map} trackerId -> predicted bbox
   */
  predictAll() {
    const predictions = new Map();

    for (const [trackerId, tracker] of this.trackers.entries()) {
      try {
        const predicted = this.predict(trackerId);
        predictions.set(trackerId, predicted);
      } catch (error) {
        console.error(`[KalmanTracker] Error predicting tracker ${trackerId}:`, error.message);
      }
    }

    return predictions;
  }

  /**
   * Update tracker with new detection
   * @param {number} trackerId
   * @param {Object} detection - Detection with bbox: {x, y, width, height}
   */
  update(trackerId, detection) {
    const tracker = this.trackers.get(trackerId);
    if (!tracker) {
      throw new Error(`Tracker ${trackerId} not found`);
    }

    const { x, y, width, height } = detection.bbox || detection;

    // Convert bbox to measurement
    const cx = x + width / 2;
    const cy = y + height / 2;
    const aspect = width / height;

    const measurement = [cx, cy, aspect, height];

    // Update Kalman filter
    const corrected = tracker.kf.correct({ observation: measurement });
    tracker.state = corrected.mean;
    tracker.lastUpdate = Date.now();
    tracker.missCount = 0;
    tracker.hitCount++;
    tracker.detection = detection;

    console.log(`[KalmanTracker] Updated tracker ${trackerId} (hits: ${tracker.hitCount})`);
  }

  /**
   * Mark tracker as missed (no detection)
   * @param {number} trackerId
   */
  miss(trackerId) {
    const tracker = this.trackers.get(trackerId);
    if (tracker) {
      tracker.missCount++;
    }
  }

  /**
   * Remove tracker
   * @param {number} trackerId
   */
  remove(trackerId) {
    if (this.trackers.delete(trackerId)) {
      console.log(`[KalmanTracker] Removed tracker ${trackerId}`);
    }
  }

  /**
   * Get all active tracker IDs
   * @returns {number[]}
   */
  getActiveTrackers() {
    return Array.from(this.trackers.keys());
  }

  /**
   * Get tracker info
   * @param {number} trackerId
   * @returns {Object}
   */
  getTracker(trackerId) {
    const tracker = this.trackers.get(trackerId);
    if (!tracker) return null;

    const [cx, cy, aspect, height, vx, vy, va, vh] = tracker.state;
    const width = aspect * height;

    return {
      trackerId,
      bbox: {
        x: Math.round(cx - width / 2),
        y: Math.round(cy - height / 2),
        width: Math.round(width),
        height: Math.round(height)
      },
      velocity: { vx, vy },
      lastUpdate: tracker.lastUpdate,
      missCount: tracker.missCount,
      hitCount: tracker.hitCount,
      confidence: this._calculateConfidence(tracker)
    };
  }

  /**
   * Calculate confidence score based on hit/miss ratio
   * @private
   */
  _calculateConfidence(tracker) {
    const hitRatio = tracker.hitCount / (tracker.hitCount + tracker.missCount);
    const recency = Math.max(0, 1 - (Date.now() - tracker.lastUpdate) / 1000);
    return hitRatio * 0.7 + recency * 0.3;
  }

  /**
   * Clean up stale trackers
   * @param {number} maxMissCount - Max consecutive misses before removal
   * @param {number} maxAgeMs - Max age in milliseconds
   */
  cleanup(maxMissCount = 15, maxAgeMs = 2000) {
    const now = Date.now();
    const toRemove = [];

    for (const [trackerId, tracker] of this.trackers.entries()) {
      const age = now - tracker.lastUpdate;
      if (tracker.missCount >= maxMissCount || age >= maxAgeMs) {
        toRemove.push(trackerId);
      }
    }

    for (const trackerId of toRemove) {
      this.remove(trackerId);
    }

    if (toRemove.length > 0) {
      console.log(`[KalmanTracker] Cleaned up ${toRemove.length} stale tracker(s)`);
    }
  }

  /**
   * Get tracker statistics
   */
  getStats() {
    return {
      activeTrackers: this.trackers.size,
      totalInitialized: this.nextTrackerId - 1,
      trackers: Array.from(this.trackers.entries()).map(([id, tracker]) => ({
        trackerId: id,
        missCount: tracker.missCount,
        hitCount: tracker.hitCount,
        age: Date.now() - tracker.lastUpdate
      }))
    };
  }
}

export default KalmanTracker;
