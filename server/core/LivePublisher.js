/**
 * Live Publisher (Lane 1)
 *
 * Publishes frames at 30 FPS with <30ms latency using predicted blur masks.
 * Never waits for verification - uses Kalman predictions and confidence decay.
 *
 * Pipeline:
 * 1. Predict blur regions (Kalman + decay)
 * 2. Apply blur (CUDA or canvas-based)
 * 3. Publish to VideoSource
 *
 * Total latency: <30ms
 */

import { createCanvas } from 'canvas';

export class LivePublisher {
  constructor(videoSource, options = {}) {
    this.videoSource = videoSource;
    this.blurMethod = options.blurMethod || 'pixelation';  // or 'gaussian'
    this.pixelSize = options.pixelSize || 20;
    this.blurRadius = options.blurRadius || 15;

    this.stats = {
      framesPublished: 0,
      avgLatencyMs: 0,
      blurRegionsApplied: 0
    };

    console.log(`[LivePublisher] Initialized with method=${this.blurMethod}`);
  }

  /**
   * Publish frame with predicted blur
   * @param {VideoFrame} frame - Original video frame
   * @param {Array} blurRegions - Array of {bbox, confidence} objects
   * @returns {Promise<number>} Latency in milliseconds
   */
  async publishWithBlur(frame, blurRegions = []) {
    const startTime = Date.now();

    try {
      if (blurRegions.length === 0) {
        // No blur needed - publish original
        this.videoSource.captureFrame(frame);
      } else {
        // Apply blur and publish
        const blurredFrame = await this._applyBlur(frame, blurRegions);
        this.videoSource.captureFrame(blurredFrame);

        this.stats.blurRegionsApplied += blurRegions.length;
      }

      const latency = Date.now() - startTime;
      this.stats.framesPublished++;
      this.stats.avgLatencyMs =
        (this.stats.avgLatencyMs * (this.stats.framesPublished - 1) + latency) / this.stats.framesPublished;

      // Log periodically
      if (this.stats.framesPublished % 150 === 0) {
        console.log(`[LivePublisher] Published ${this.stats.framesPublished} frames, avg latency: ${this.stats.avgLatencyMs.toFixed(2)}ms`);
      }

      return latency;
    } catch (error) {
      console.error(`[LivePublisher] Error publishing frame:`, error.message);
      // Fallback: publish original frame
      this.videoSource.captureFrame(frame);
      return Date.now() - startTime;
    }
  }

  /**
   * Apply blur to frame regions
   * @private
   */
  async _applyBlur(frame, blurRegions) {
    // Convert frame to RGBA
    const rgbaFrame = frame.convert(require('@livekit/rtc-node').VideoBufferType.RGBA);

    // Create canvas
    const canvas = createCanvas(frame.width, frame.height);
    const ctx = canvas.getContext('2d');

    // Put original image on canvas
    const imageData = ctx.createImageData(frame.width, frame.height);
    imageData.data.set(new Uint8ClampedArray(rgbaFrame.data));
    ctx.putImageData(imageData, 0, 0);

    // Apply blur to each region
    for (const region of blurRegions) {
      const { bbox } = region;

      // Clamp bbox to frame dimensions
      const x = Math.max(0, Math.min(bbox.x, frame.width));
      const y = Math.max(0, Math.min(bbox.y, frame.height));
      const w = Math.min(bbox.width, frame.width - x);
      const h = Math.min(bbox.height, frame.height - y);

      if (w <= 0 || h <= 0) continue;

      if (this.blurMethod === 'pixelation') {
        this._applyPixelation(ctx, x, y, w, h);
      } else if (this.blurMethod === 'gaussian') {
        this._applyGaussianBlur(ctx, x, y, w, h);
      }
    }

    // Get blurred image data
    const blurredData = ctx.getImageData(0, 0, frame.width, frame.height);

    // Create new VideoFrame
    const VideoFrame = require('@livekit/rtc-node').VideoFrame;
    const VideoBufferType = require('@livekit/rtc-node').VideoBufferType;

    const blurredFrame = new VideoFrame(
      new Uint8Array(blurredData.data.buffer),
      frame.width,
      frame.height,
      VideoBufferType.RGBA
    );

    return blurredFrame;
  }

  /**
   * Apply pixelation effect (fast, GPU-friendly)
   * @private
   */
  _applyPixelation(ctx, x, y, w, h) {
    const regionData = ctx.getImageData(x, y, w, h);
    const pixelSize = this.pixelSize;

    for (let py = 0; py < h; py += pixelSize) {
      for (let px = 0; px < w; px += pixelSize) {
        // Get average color of block
        let r = 0, g = 0, b = 0, count = 0;

        for (let by = 0; by < pixelSize && (py + by) < h; by++) {
          for (let bx = 0; bx < pixelSize && (px + bx) < w; bx++) {
            const idx = ((py + by) * w + (px + bx)) * 4;
            r += regionData.data[idx];
            g += regionData.data[idx + 1];
            b += regionData.data[idx + 2];
            count++;
          }
        }

        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);

        // Fill block with average color
        for (let by = 0; by < pixelSize && (py + by) < h; by++) {
          for (let bx = 0; bx < pixelSize && (px + bx) < w; bx++) {
            const idx = ((py + by) * w + (px + bx)) * 4;
            regionData.data[idx] = r;
            regionData.data[idx + 1] = g;
            regionData.data[idx + 2] = b;
          }
        }
      }
    }

    ctx.putImageData(regionData, x, y);
  }

  /**
   * Apply Gaussian blur effect (slower, better quality)
   * @private
   */
  _applyGaussianBlur(ctx, x, y, w, h) {
    // Extract region
    const regionData = ctx.getImageData(x, y, w, h);

    // Apply box blur (approximation of Gaussian)
    const radius = this.blurRadius;
    const passes = 3;  // Multiple passes for smoother blur

    for (let pass = 0; pass < passes; pass++) {
      this._boxBlur(regionData, w, h, radius);
    }

    ctx.putImageData(regionData, x, y);
  }

  /**
   * Box blur implementation
   * @private
   */
  _boxBlur(imageData, width, height, radius) {
    const data = imageData.data;
    const temp = new Uint8ClampedArray(data.length);

    // Horizontal pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, count = 0;

        for (let kx = -radius; kx <= radius; kx++) {
          const px = Math.max(0, Math.min(width - 1, x + kx));
          const idx = (y * width + px) * 4;
          r += data[idx];
          g += data[idx + 1];
          b += data[idx + 2];
          count++;
        }

        const idx = (y * width + x) * 4;
        temp[idx] = r / count;
        temp[idx + 1] = g / count;
        temp[idx + 2] = b / count;
        temp[idx + 3] = data[idx + 3];
      }
    }

    // Vertical pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, count = 0;

        for (let ky = -radius; ky <= radius; ky++) {
          const py = Math.max(0, Math.min(height - 1, y + ky));
          const idx = (py * width + x) * 4;
          r += temp[idx];
          g += temp[idx + 1];
          b += temp[idx + 2];
          count++;
        }

        const idx = (y * width + x) * 4;
        data[idx] = r / count;
        data[idx + 1] = g / count;
        data[idx + 2] = b / count;
      }
    }
  }

  /**
   * Get publisher statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      framesPublished: 0,
      avgLatencyMs: 0,
      blurRegionsApplied: 0
    };
  }
}

export default LivePublisher;
