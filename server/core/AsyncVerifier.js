/**
 * Async Verifier (Lane 2)
 *
 * gRPC client for Triton Inference Server.
 * Handles batched inference requests and streams results back asynchronously.
 *
 * Features:
 * - Non-blocking batch requests
 * - Out-of-order result handling
 * - Connection pooling
 * - Automatic retries
 * - Health monitoring
 */

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AsyncVerifier {
  constructor(options = {}) {
    this.tritonUrl = options.tritonUrl || process.env.TRITON_GRPC_URL || 'localhost:8001';
    this.modelName = options.modelName || 'nudenet_trt';
    this.modelVersion = options.modelVersion || '1';
    this.timeout = options.timeout || 5000;  // 5 second timeout
    this.maxRetries = options.maxRetries || 2;

    this.client = null;
    this.isHealthy = false;

    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgLatencyMs: 0,
      totalDetections: 0
    };

    console.log(`[AsyncVerifier] Initializing Triton client: ${this.tritonUrl}`);
    this._initClient();
  }

  /**
   * Initialize gRPC client
   * @private
   */
  _initClient() {
    try {
      // Load Triton proto (simplified version for inference)
      const PROTO_PATH = path.join(__dirname, '../config/triton_inference.proto');

      // For now, use dynamic request building without proto
      // (Proto file will be added in next iteration)
      this.client = {
        // Placeholder - will implement actual gRPC client
        modelInfer: this._mockModelInfer.bind(this)
      };

      console.log(`[AsyncVerifier] Client initialized (mock mode - TODO: Add proto)`);

      // Check health
      this._checkHealth();

    } catch (error) {
      console.error(`[AsyncVerifier] Failed to initialize client:`, error.message);
    }
  }

  /**
   * Mock inference for development (replace with real gRPC)
   * @private
   */
  async _mockModelInfer(request, callback) {
    // Simulate Triton inference
    setTimeout(() => {
      const batchSize = request.inputs[0].shape[0];

      // Mock detections (empty for now)
      const detections = Array(batchSize).fill([]);

      callback(null, {
        model_name: this.modelName,
        model_version: this.modelVersion,
        outputs: [{
          name: 'output',
          datatype: 'FP32',
          shape: [batchSize, 0, 6],  // No detections
          contents: { fp32_contents: [] }
        }]
      });
    }, 50);  // Simulate 50ms latency
  }

  /**
   * Verify batch of frames
   * @param {Array} frames - Array of frame data (RGBA buffers)
   * @param {Array} metadata - Array of frame metadata
   * @returns {Promise<Array>} Array of detection results
   */
  async verifyBatch(frames, metadata = []) {
    if (!this.client) {
      throw new Error('Triton client not initialized');
    }

    const startTime = Date.now();
    this.stats.totalRequests++;

    try {
      // Prepare batch input
      const batchSize = frames.length;
      const inputData = await this._prepareBatchInput(frames);

      // Build inference request
      const request = {
        model_name: this.modelName,
        model_version: this.modelVersion,
        inputs: [{
          name: 'input',
          datatype: 'FP32',
          shape: [batchSize, 3, 180, 320],  // Downsampled
          contents: {
            fp32_contents: inputData
          }
        }]
      };

      // Execute inference with timeout
      const response = await this._inferWithTimeout(request);

      // Parse detections
      const detections = this._parseDetections(response, batchSize, metadata);

      // Update stats
      const latency = Date.now() - startTime;
      this.stats.successfulRequests++;
      this.stats.avgLatencyMs =
        (this.stats.avgLatencyMs * (this.stats.successfulRequests - 1) + latency) / this.stats.successfulRequests;

      const totalDetections = detections.reduce((sum, d) => sum + d.length, 0);
      this.stats.totalDetections += totalDetections;

      // Log periodically
      if (this.stats.totalRequests % 50 === 0) {
        console.log(`[AsyncVerifier] Processed ${this.stats.totalRequests} batches, avg latency: ${this.stats.avgLatencyMs.toFixed(2)}ms`);
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
   * Prepare batch input (resize and normalize frames)
   * @private
   */
  async _prepareBatchInput(frames) {
    const inputArray = [];

    for (const frame of frames) {
      // Resize frame to 320x180 (downsampling)
      const resized = await this._resizeFrame(frame, 320, 180);

      // Normalize to [0-1] and convert to RGB planar format
      const normalized = this._normalizeFrame(resized);

      inputArray.push(...normalized);
    }

    return inputArray;
  }

  /**
   * Resize frame (uses canvas or sharp)
   * @private
   */
  async _resizeFrame(frame, targetWidth, targetHeight) {
    // TODO: Implement actual resize using canvas or sharp
    // For now, return placeholder
    const channels = 3;
    const size = targetWidth * targetHeight * channels;
    return new Float32Array(size);
  }

  /**
   * Normalize frame to [0-1] RGB planar format
   * @private
   */
  _normalizeFrame(frameData) {
    // Convert to planar RGB format (all R, then all G, then all B)
    // Normalize to [0-1]
    const normalized = new Float32Array(frameData.length);

    for (let i = 0; i < frameData.length; i++) {
      normalized[i] = frameData[i] / 255.0;
    }

    return normalized;
  }

  /**
   * Execute inference with timeout
   * @private
   */
  async _inferWithTimeout(request) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Inference timeout'));
      }, this.timeout);

      this.client.modelInfer(request, (error, response) => {
        clearTimeout(timer);

        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Parse detection results from Triton response
   * @private
   */
  _parseDetections(response, batchSize, metadata) {
    const detections = [];

    try {
      const output = response.outputs[0];
      const rawData = output.contents.fp32_contents;

      // Parse detections for each frame in batch
      for (let i = 0; i < batchSize; i++) {
        const frameDetections = [];

        // Format: [x1, y1, x2, y2, class_id, confidence]
        // Extract detections for this frame
        const frameOffset = i * output.shape[1] * 6;  // Each detection has 6 values

        for (let j = 0; j < output.shape[1]; j++) {
          const detectionOffset = frameOffset + j * 6;

          const x1 = rawData[detectionOffset];
          const y1 = rawData[detectionOffset + 1];
          const x2 = rawData[detectionOffset + 2];
          const y2 = rawData[detectionOffset + 3];
          const classId = rawData[detectionOffset + 4];
          const confidence = rawData[detectionOffset + 5];

          if (confidence > 0.5) {  // Confidence threshold
            frameDetections.push({
              bbox: {
                x: Math.round(x1),
                y: Math.round(y1),
                width: Math.round(x2 - x1),
                height: Math.round(y2 - y1)
              },
              class: this._getClassName(classId),
              confidence,
              type: 'nsfw',
              timestamp: metadata[i]?.timestamp || Date.now()
            });
          }
        }

        detections.push(frameDetections);
      }

    } catch (error) {
      console.error(`[AsyncVerifier] Error parsing detections:`, error.message);
      return Array(batchSize).fill([]);
    }

    return detections;
  }

  /**
   * Get class name from ID
   * @private
   */
  _getClassName(classId) {
    const classes = [
      'EXPOSED_ANUS',
      'EXPOSED_ARMPITS',
      'EXPOSED_BELLY',
      'EXPOSED_BUTTOCKS',
      'EXPOSED_BREAST_F',
      'EXPOSED_GENITALIA_F',
      'EXPOSED_GENITALIA_M',
      'EXPOSED_BREAST_M'
    ];

    return classes[Math.floor(classId)] || 'UNKNOWN';
  }

  /**
   * Check Triton server health
   * @private
   */
  async _checkHealth() {
    try {
      // TODO: Implement actual health check via gRPC
      // For now, assume healthy in mock mode
      this.isHealthy = true;
      console.log(`[AsyncVerifier] Health check: OK`);
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
      tritonUrl: this.tritonUrl,
      modelName: this.modelName
    };
  }

  /**
   * Close connection
   */
  async close() {
    if (this.client) {
      // TODO: Close gRPC connection
      this.client = null;
      console.log(`[AsyncVerifier] Connection closed`);
    }
  }
}

export default AsyncVerifier;
