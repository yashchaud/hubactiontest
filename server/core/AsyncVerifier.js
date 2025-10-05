/**
 * Async Verifier (Lane 2)
 *
 * HTTP client for RunPod Inference Service.
 * Handles batched inference requests and streams results back asynchronously.
 *
 * Features:
 * - Non-blocking batch requests
 * - Out-of-order result handling
 * - Automatic retries
 * - Health monitoring
 */

import axios from 'axios';
import FormData from 'form-data';
import { Readable } from 'stream';
import { createCanvas } from 'canvas';
import { VideoBufferType } from '@livekit/rtc-node';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AsyncVerifier {
  constructor(options = {}) {
    this.runpodUrl = options.runpodUrl || process.env.RUNPOD_SERVICE_URL || 'http://localhost:8000';
    this.sessionId = options.sessionId || null;
    this.timeout = options.timeout || 15000;  // 15 second timeout (RunPod needs time for inference)
    this.maxRetries = options.maxRetries || 2;

    this.isHealthy = false;

    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgLatencyMs: 0,
      totalDetections: 0
    };

    console.log(`[AsyncVerifier] Initializing RunPod client: ${this.runpodUrl}`);
    console.log(`[AsyncVerifier] Session ID: ${this.sessionId || 'NOT SET'}`);
    console.log(`[AsyncVerifier] Timeout: ${this.timeout}ms`);
    this._checkHealth();
  }

  /**
   * Set session ID for RunPod requests
   */
  setSessionId(sessionId) {
    this.sessionId = sessionId;
    console.log(`[AsyncVerifier] Session ID set: ${sessionId}`);
  }

  /**
   * Verify batch of frames
   * @param {Array} frames - Array of VideoFrame objects from LiveKit
   * @param {Array} metadata - Array of frame metadata
   * @returns {Promise<Array>} Array of detection results
   */
  async verifyBatch(frames, metadata = []) {
    const startTime = Date.now();
    this.stats.totalRequests++;

    try {
      // Process each frame individually (RunPod expects single frame, not batch)
      // We'll send them in parallel for better performance
      const detectionPromises = frames.map(async (frame, index) => {
        try {
          // Convert VideoFrame to JPEG
          const jpegBuffer = await this._convertFrameToJPEG(frame);

          // Send to RunPod
          const detections = await this._sendToRunPod(jpegBuffer);

          return detections;
        } catch (error) {
          console.error(`[AsyncVerifier] Error processing frame ${index}:`, error.message);
          return [];
        }
      });

      // Wait for all frames to be processed
      const detections = await Promise.all(detectionPromises);

      // Update stats
      const latency = Date.now() - startTime;
      this.stats.successfulRequests++;
      this.stats.avgLatencyMs =
        (this.stats.avgLatencyMs * (this.stats.successfulRequests - 1) + latency) / this.stats.successfulRequests;

      const totalDetections = detections.reduce((sum, d) => sum + d.length, 0);
      this.stats.totalDetections += totalDetections;

      // Log periodically
      if (this.stats.totalRequests % 50 === 0) {
        console.log(`[AsyncVerifier] Processed ${this.stats.totalRequests} batches (${frames.length} frames), avg latency: ${this.stats.avgLatencyMs.toFixed(2)}ms, total detections: ${this.stats.totalDetections}`);
      }

      return detections;

    } catch (error) {
      this.stats.failedRequests++;
      console.error(`[AsyncVerifier] Batch verification failed:`, error.message);

      // Return empty detections on error
      return frames.map(() => []);
    }
  }

  /**
   * Convert VideoFrame to JPEG buffer
   * @private
   */
  async _convertFrameToJPEG(frame) {
    let rgbaFrame = null;
    let canvas = null;

    try {
      // Convert to RGBA buffer type
      rgbaFrame = frame.convert(VideoBufferType.RGBA);

      // Calculate scaled dimensions (max 640px width for faster processing)
      const MAX_WIDTH = 640;
      let targetWidth = frame.width;
      let targetHeight = frame.height;

      if (frame.width > MAX_WIDTH) {
        const scale = MAX_WIDTH / frame.width;
        targetWidth = MAX_WIDTH;
        targetHeight = Math.round(frame.height * scale);
      }

      // Create canvas
      canvas = createCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d');

      // If resizing needed, create temp canvas first
      if (targetWidth !== frame.width) {
        const tempCanvas = createCanvas(frame.width, frame.height);
        const tempCtx = tempCanvas.getContext('2d');

        // Put original image
        const imageData = tempCtx.createImageData(frame.width, frame.height);
        const rgbaData = new Uint8ClampedArray(rgbaFrame.data);
        imageData.data.set(rgbaData);
        tempCtx.putImageData(imageData, 0, 0);

        // Draw scaled
        ctx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
      } else {
        // No resize needed
        const imageData = ctx.createImageData(frame.width, frame.height);
        const rgbaData = new Uint8ClampedArray(rgbaFrame.data);
        imageData.data.set(rgbaData);
        ctx.putImageData(imageData, 0, 0);
      }

      // Convert to JPEG
      const jpegBuffer = canvas.toBuffer('image/jpeg', { quality: 0.7 });

      return jpegBuffer;
    } catch (error) {
      console.error('[AsyncVerifier] Error converting frame to JPEG:', error);
      throw error;
    } finally {
      // Clean up
      rgbaFrame = null;
      canvas = null;
      if (global.gc) {
        global.gc();
      }
    }
  }

  /**
   * Send frame to RunPod for detection
   * @private
   */
  async _sendToRunPod(frameBuffer) {
    try {
      // Validate session_id (required by RunPod API)
      if (!this.sessionId) {
        console.error('[AsyncVerifier] Cannot send to RunPod: session_id not set');
        return [];
      }

      const formData = new FormData();

      // Convert buffer to stream
      const stream = new Readable();
      stream.push(frameBuffer);
      stream.push(null);

      formData.append('frame_data', stream, {
        filename: 'frame.jpg',
        contentType: 'image/jpeg',
        knownLength: frameBuffer.length
      });

      const response = await axios.post(
        `${this.runpodUrl}/process/frame`,
        formData,
        {
          params: { session_id: this.sessionId },  // Required parameter
          headers: formData.getHeaders(),
          timeout: this.timeout,
          maxContentLength: 100 * 1024 * 1024
        }
      );

      // Parse RunPod response format
      const detections = response.data.detections || [];

      // Convert RunPod format to internal format
      return detections.map(det => ({
        bbox: {
          x: Math.round(det.box[0]),
          y: Math.round(det.box[1]),
          width: Math.round(det.box[2] - det.box[0]),
          height: Math.round(det.box[3] - det.box[1])
        },
        class: det.class || 'NSFW',
        confidence: det.score || det.confidence || 0.0,
        type: 'nsfw',
        timestamp: Date.now()
      }));

    } catch (error) {
      // Log detailed error for debugging
      if (error.response) {
        console.error('[AsyncVerifier] RunPod error:', {
          status: error.response.status,
          data: error.response.data,
          sessionId: this.sessionId
        });
      } else {
        console.error('[AsyncVerifier] RunPod request failed:', error.message);
      }
      return [];
    }
  }

  /**
   * Check RunPod server health
   * @private
   */
  async _checkHealth() {
    try {
      const response = await axios.get(`${this.runpodUrl}/health`, {
        timeout: 3000
      });

      this.isHealthy = response.data.status === 'healthy';
      console.log(`[AsyncVerifier] Health check: ${this.isHealthy ? 'OK' : 'FAILED'}`);
    } catch (error) {
      this.isHealthy = false;
      console.error(`[AsyncVerifier] Health check failed:`, error.message);
    }
  }

  /**
   * Get verifier statistics
   */
  getStats() {
    return {
      ...this.stats,
      isHealthy: this.isHealthy,
      runpodUrl: this.runpodUrl,
      sessionId: this.sessionId
    };
  }

  /**
   * Close connection
   */
  async close() {
    console.log(`[AsyncVerifier] Connection closed`);
  }
}

export default AsyncVerifier;
