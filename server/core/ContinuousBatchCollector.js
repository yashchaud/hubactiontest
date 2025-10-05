/**
 * Continuous Batch Collector
 *
 * Implements continuous batching for ML inference:
 * - Collects frames with configurable max wait time
 * - Dynamic batch sizing (4-8 frames optimal)
 * - Backpressure handling
 * - Out-of-order result processing
 *
 * Based on industry best practices from vLLM, Triton, SageMaker
 */

import EventEmitter from 'events';

export class ContinuousBatchCollector extends EventEmitter {
  constructor(options = {}) {
    super();

    this.maxWaitMs = options.maxWaitMs || 30;  // Queue wait time (10-50ms range)
    this.minBatchSize = options.minBatchSize || 1;
    this.maxBatchSize = options.maxBatchSize || 8;
    this.maxPending = options.maxPending || 15;  // Max concurrent batches

    this.queue = [];  // Pending frames
    this.pendingBatches = 0;  // Currently processing batches
    this.batchId = 0;
    this.timer = null;
    this.isRunning = true;

    this.stats = {
      totalFrames: 0,
      totalBatches: 0,
      droppedFrames: 0,
      avgBatchSize: 0,
      avgWaitTimeMs: 0
    };

    console.log(`[BatchCollector] Initialized: maxWait=${this.maxWaitMs}ms, batchSize=${this.minBatchSize}-${this.maxBatchSize}`);
  }

  /**
   * Add frame to batch queue
   * @param {Object} frame - Frame data to process
   * @returns {Promise} Resolves when frame is batched (not processed)
   */
  async add(frame) {
    if (!this.isRunning) {
      throw new Error('Batch collector is stopped');
    }

    // Backpressure: Drop frame if too many pending batches
    if (this.pendingBatches >= this.maxPending) {
      this.stats.droppedFrames++;
      this.emit('frame:dropped', {
        reason: 'backpressure',
        queueDepth: this.queue.length,
        pendingBatches: this.pendingBatches
      });
      return;
    }

    // Add frame with metadata
    const queueItem = {
      frame,
      timestamp: Date.now(),
      frameId: this.stats.totalFrames++
    };

    this.queue.push(queueItem);

    // Start timer if not already running
    if (!this.timer) {
      this.timer = setTimeout(() => this._processBatch(), this.maxWaitMs);
    }

    // Process immediately if batch is full
    if (this.queue.length >= this.maxBatchSize) {
      clearTimeout(this.timer);
      this.timer = null;
      await this._processBatch();
    }
  }

  /**
   * Process collected batch
   * @private
   */
  async _processBatch() {
    if (this.queue.length === 0) {
      this.timer = null;
      return;
    }

    // Extract batch
    const batchSize = Math.min(this.queue.length, this.maxBatchSize);
    const batch = this.queue.splice(0, batchSize);
    const currentBatchId = this.batchId++;

    // Calculate stats
    const waitTimes = batch.map(item => Date.now() - item.timestamp);
    const avgWait = waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length;

    this.stats.totalBatches++;
    this.stats.avgBatchSize =
      (this.stats.avgBatchSize * (this.stats.totalBatches - 1) + batchSize) / this.stats.totalBatches;
    this.stats.avgWaitTimeMs =
      (this.stats.avgWaitTimeMs * (this.stats.totalBatches - 1) + avgWait) / this.stats.totalBatches;

    this.timer = null;

    // Emit batch event (non-blocking)
    this.pendingBatches++;

    this.emit('batch:ready', {
      batchId: currentBatchId,
      frames: batch.map(item => item.frame),
      metadata: batch.map(item => ({
        frameId: item.frameId,
        timestamp: item.timestamp,
        waitTime: Date.now() - item.timestamp
      })),
      batchSize,
      onComplete: () => {
        this.pendingBatches--;
        this.emit('batch:complete', { batchId: currentBatchId });
      }
    });

    // Continue processing if queue not empty
    if (this.queue.length > 0) {
      this.timer = setTimeout(() => this._processBatch(), this.maxWaitMs);
    }
  }

  /**
   * Get current queue status
   */
  getStatus() {
    return {
      queueDepth: this.queue.length,
      pendingBatches: this.pendingBatches,
      isRunning: this.isRunning,
      stats: { ...this.stats }
    };
  }

  /**
   * Flush all pending frames immediately
   */
  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length > 0) {
      await this._processBatch();
    }
  }

  /**
   * Stop collector and clear queue
   */
  async stop() {
    this.isRunning = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.queue = [];
    this.emit('stopped');

    console.log(`[BatchCollector] Stopped. Stats:`, this.stats);
  }
}

export default ContinuousBatchCollector;
