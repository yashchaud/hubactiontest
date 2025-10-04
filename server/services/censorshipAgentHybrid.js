/**
 * Hybrid Censorship Agent (3-Lane Architecture)
 *
 * Implements real-time content moderation with <30ms publish latency and 0 frame leaks.
 *
 * LANE 1 (Live Path): Kalman predict → Apply blur → Publish (<30ms)
 * LANE 2 (Verification): Batch collect → Triton verify (async, 50-200ms)
 * LANE 3 (Tracking): Update Kalman → Decay confidence → Feed Lane 1
 *
 * Uses @livekit/rtc-node for native Node.js WebRTC support
 */

import {
  Room,
  RoomEvent,
  VideoStream,
  TrackKind,
  VideoBufferType,
  VideoSource,
  LocalVideoTrack,
  TrackPublishOptions,
  TrackSource
} from '@livekit/rtc-node';
import { EventEmitter } from 'events';
import ContinuousBatchCollector from '../core/ContinuousBatchCollector.js';
import LivePublisher from '../core/LivePublisher.js';
import AsyncVerifier from '../core/AsyncVerifier.js';
import KalmanTracker from '../tracking/KalmanTracker.js';
import ConfidenceDecay from '../tracking/ConfidenceDecay.js';

// Configuration from environment
const KALMAN_ENABLED = process.env.KALMAN_ENABLED !== 'false';
const BATCH_MAX_WAIT_MS = parseInt(process.env.BATCH_MAX_WAIT_MS) || 30;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 8;
const CONFIDENCE_DECAY_RATE = parseFloat(process.env.CONFIDENCE_DECAY_RATE) || 0.85;
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE) || 0.3;
const BLUR_DILATION_PX = parseInt(process.env.BLUR_DILATION_PX) || 8;

/**
 * Hybrid Censorship Agent - 3-Lane Architecture
 */
class CensorshipAgentHybrid extends EventEmitter {
  constructor() {
    super();
    this.activeRooms = new Map(); // roomName -> roomInfo

    console.log('[CensorshipAgent] Hybrid 3-Lane Architecture Initialized');
    console.log(`  - Kalman tracking: ${KALMAN_ENABLED ? 'Enabled' : 'Disabled'}`);
    console.log(`  - Batch wait: ${BATCH_MAX_WAIT_MS}ms`);
    console.log(`  - Batch size: ${BATCH_SIZE}`);
    console.log(`  - Confidence decay: ${CONFIDENCE_DECAY_RATE}/frame`);
    console.log(`  - Min confidence: ${MIN_CONFIDENCE}`);
    console.log(`  - Blur dilation: ${BLUR_DILATION_PX}px`);
  }

  /**
   * Connect agent to room as server-side participant
   */
  async connect(roomName, wsUrl, token, censorshipSessionId) {
    if (this.activeRooms.has(roomName)) {
      console.log(`[CensorshipAgent] Already connected to ${roomName}`);
      return this.activeRooms.get(roomName);
    }

    try {
      console.log(`[CensorshipAgent] Connecting to ${roomName} (3-Lane Hybrid)`);

      const room = new Room();

      // Initialize 3-lane components
      const roomInfo = {
        roomName,
        room,
        censorshipSessionId,

        // Video track references
        broadcasterTrack: null,
        videoStream: null,
        videoSource: null,
        censoredTrack: null,

        // Lane 1: Live Publisher
        livePublisher: null,

        // Lane 2: Async Verification
        batchCollector: new ContinuousBatchCollector({
          maxWaitMs: BATCH_MAX_WAIT_MS,
          maxBatchSize: BATCH_SIZE,
          maxPending: 15
        }),
        asyncVerifier: new AsyncVerifier({
          tritonUrl: process.env.TRITON_GRPC_URL
        }),

        // Lane 3: Tracking & Prediction
        kalmanTracker: KALMAN_ENABLED ? new KalmanTracker({
          processNoise: 0.01,
          measurementNoise: 0.1
        }) : null,
        confidenceDecay: new ConfidenceDecay({
          decayRate: CONFIDENCE_DECAY_RATE,
          minConfidence: MIN_CONFIDENCE,
          dilationPx: BLUR_DILATION_PX
        }),

        // State
        frameCount: 0,
        detectionCount: 0,
        startedAt: new Date(),
        isProcessing: false,
        frameWidth: 0,
        frameHeight: 0
      };

      this.activeRooms.set(roomName, roomInfo);

      // Setup event handlers
      this._setupRoomEvents(room, roomName);

      // Connect to LiveKit room
      await room.connect(wsUrl, token, {
        autoSubscribe: false  // Manual subscription control
      });

      console.log(`[CensorshipAgent] Connected to ${roomName} as ${room.localParticipant.identity}`);

      // Check for existing tracks
      await this._checkExistingTracks(roomName);

      return {
        success: true,
        roomName,
        agentIdentity: room.localParticipant.identity
      };

    } catch (error) {
      console.error(`[CensorshipAgent] Error connecting to ${roomName}:`, error);
      this.activeRooms.delete(roomName);
      throw error;
    }
  }

  /**
   * Setup room event handlers
   * @private
   */
  _setupRoomEvents(room, roomName) {
    // Track published
    room.on(RoomEvent.TrackPublished, async (publication, participant) => {
      console.log(`[CensorshipAgent] ${roomName} - Track published: ${participant.identity}, kind=${publication.kind}`);

      // Subscribe to broadcaster video only (kind 2 = VIDEO)
      if (participant.identity.includes('broadcaster') && publication.kind === 2) {
        console.log(`[CensorshipAgent] ${roomName} - Subscribing to broadcaster video`);
        publication.setSubscribed(true);
      } else if (publication.kind === 1) {
        publication.setSubscribed(false);  // Skip audio
      }
    });

    // Track subscribed - start 3-lane pipeline
    room.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
      await this._handleTrackSubscribed(roomName, track, publication, participant);
    });

    // Disconnection
    room.on(RoomEvent.Disconnected, () => {
      console.log(`[CensorshipAgent] Disconnected from ${roomName}`);
      this._cleanup(roomName);
    });
  }

  /**
   * Check for existing broadcaster tracks
   * @private
   */
  async _checkExistingTracks(roomName) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo || !roomInfo.room.remoteParticipants) return;

    const participants = Array.from(roomInfo.room.remoteParticipants.values());
    console.log(`[CensorshipAgent] ${roomName} - Checking ${participants.length} participant(s)`);

    for (const participant of participants) {
      if (!participant.identity.includes('broadcaster')) continue;

      console.log(`[CensorshipAgent] ${roomName} - Found broadcaster: ${participant.identity}`);

      if (participant.trackPublications instanceof Map) {
        for (const [sid, publication] of participant.trackPublications) {
          if (publication.kind === 2 && !publication.subscribed) {
            console.log(`[CensorshipAgent] ${roomName} - Subscribing to video: ${sid}`);
            publication.setSubscribed(true);
          }
        }
      }
    }
  }

  /**
   * Handle track subscription - start 3-lane pipeline
   * @private
   */
  async _handleTrackSubscribed(roomName, track, publication, participant) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    // Only process video tracks from broadcaster
    if (track.kind !== TrackKind.KIND_VIDEO || !participant.identity.includes('broadcaster')) {
      console.log(`[CensorshipAgent] ${roomName} - Ignoring track from ${participant.identity}`);
      return;
    }

    console.log(`[CensorshipAgent] ${roomName} - Starting 3-Lane Hybrid Pipeline`);
    roomInfo.broadcasterTrack = track;

    // Initialize VideoSource for publishing
    await this._initializeVideoSource(roomName, 1280, 720);

    // Start hybrid pipeline
    await this._startHybridPipeline(roomName, track);
  }

  /**
   * Initialize VideoSource for publishing censored frames
   * @private
   */
  async _initializeVideoSource(roomName, width, height) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    try {
      console.log(`[CensorshipAgent] ${roomName} - Initializing VideoSource (${width}x${height})`);

      // Create VideoSource
      roomInfo.videoSource = new VideoSource(width, height);
      roomInfo.frameWidth = width;
      roomInfo.frameHeight = height;

      // Create LivePublisher (Lane 1)
      roomInfo.livePublisher = new LivePublisher(roomInfo.videoSource, {
        blurMethod: 'pixelation',
        pixelSize: 20
      });

      // Create LocalVideoTrack
      const track = LocalVideoTrack.createVideoTrack('censored-video', roomInfo.videoSource);

      // Publish options
      const options = new TrackPublishOptions();
      options.source = TrackSource.TRACK_SOURCE_CAMERA;

      // Publish censored track
      const publication = await roomInfo.room.localParticipant.publishTrack(track, options);
      roomInfo.censoredTrack = track;

      console.log(`[CensorshipAgent] ${roomName} - Published censored track: ${publication.trackSid}`);

      this.emit('censored-track:published', {
        roomName,
        trackSid: publication.trackSid
      });

    } catch (error) {
      console.error(`[CensorshipAgent] ${roomName} - Error initializing VideoSource:`, error);
      throw error;
    }
  }

  /**
   * Start 3-Lane Hybrid Pipeline
   * @private
   */
  async _startHybridPipeline(roomName, track) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo || roomInfo.isProcessing) return;

    roomInfo.isProcessing = true;
    console.log(`[CensorshipAgent] ${roomName} - Starting hybrid pipeline (3 lanes)`);

    // Create video stream
    const videoStream = new VideoStream(track);
    roomInfo.videoStream = videoStream;

    // Setup Lane 2: Batch collection
    this._setupBatchProcessing(roomName);

    // Start main loop (Lane 1 + Lane 3)
    this._runHybridLoop(roomName, videoStream);

    this.emit('processing:started', { roomName });
  }

  /**
   * Setup Lane 2: Batch processing with AsyncVerifier
   * @private
   */
  _setupBatchProcessing(roomName) {
    const roomInfo = this.activeRooms.get(roomName);

    // Listen for batch ready events
    roomInfo.batchCollector.on('batch:ready', async (batchData) => {
      try {
        // Verify batch with Triton (Lane 2)
        const detections = await roomInfo.asyncVerifier.verifyBatch(
          batchData.frames,
          batchData.metadata
        );

        // Update trackers with detections (Lane 3)
        this._updateTrackersWithDetections(roomName, detections, batchData.metadata);

        // Mark batch complete
        batchData.onComplete();

      } catch (error) {
        console.error(`[CensorshipAgent] ${roomName} - Batch processing error:`, error.message);
        batchData.onComplete();
      }
    });

    // Handle dropped frames
    roomInfo.batchCollector.on('frame:dropped', (info) => {
      console.warn(`[CensorshipAgent] ${roomName} - Frame dropped:`, info.reason);
    });
  }

  /**
   * Run hybrid processing loop (Lane 1 + Lane 3)
   * @private
   */
  async _runHybridLoop(roomName, videoStream) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    try {
      console.log(`[CensorshipAgent] ${roomName} - Hybrid loop started`);

      for await (const event of videoStream) {
        if (!this.activeRooms.has(roomName)) break;

        const frame = event.frame;
        roomInfo.frameCount++;

        // LANE 3: Predict + Decay (2-5ms)
        const blurRegions = this._predictBlurRegions(roomName);

        // LANE 1: Publish with predicted blur (<30ms)
        await roomInfo.livePublisher.publishWithBlur(frame, blurRegions);

        // LANE 2: Queue for async verification (non-blocking)
        this._queueFrameForVerification(roomName, frame);

        // Periodic logging
        if (roomInfo.frameCount % 150 === 0) {
          this._logStatus(roomName);
        }
      }

      console.log(`[CensorshipAgent] ${roomName} - Hybrid loop ended`);

    } catch (error) {
      console.error(`[CensorshipAgent] ${roomName} - Hybrid loop error:`, error);
    } finally {
      videoStream.close();
      roomInfo.isProcessing = false;
    }
  }

  /**
   * Lane 3: Predict blur regions using Kalman + Confidence Decay
   * @private
   */
  _predictBlurRegions(roomName) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return [];

    // Apply confidence decay (removes stale regions)
    const activeRegions = roomInfo.confidenceDecay.decay();

    // Get blur regions from active trackers
    let blurRegions = roomInfo.confidenceDecay.getBlurRegions();

    // If Kalman tracking enabled, predict positions
    if (KALMAN_ENABLED && roomInfo.kalmanTracker) {
      const predictions = roomInfo.kalmanTracker.predictAll();

      // Update blur regions with predicted positions
      for (const [trackerId, predicted] of predictions.entries()) {
        const regionId = roomInfo.confidenceDecay.update(predicted, trackerId);
      }

      // Cleanup stale trackers
      roomInfo.kalmanTracker.cleanup(15, 2000);

      // Get updated blur regions
      blurRegions = roomInfo.confidenceDecay.getBlurRegions();
    }

    return blurRegions;
  }

  /**
   * Lane 2: Queue frame for async verification
   * @private
   */
  _queueFrameForVerification(roomName, frame) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    // Add to batch collector (non-blocking)
    roomInfo.batchCollector.add(frame).catch(err => {
      // Silently handle backpressure (frame dropped, but still publishing)
    });
  }

  /**
   * Lane 3: Update trackers with verification results
   * @private
   */
  _updateTrackersWithDetections(roomName, detectionsArray, metadata) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    for (let i = 0; i < detectionsArray.length; i++) {
      const detections = detectionsArray[i];
      const frameMeta = metadata[i];

      if (detections.length > 0) {
        roomInfo.detectionCount += detections.length;

        for (const detection of detections) {
          // Update or initialize Kalman tracker
          if (KALMAN_ENABLED && roomInfo.kalmanTracker) {
            // Try to find existing tracker for this detection
            let trackerId = null;

            // Simple association: closest tracker (TODO: Hungarian algorithm)
            const trackers = roomInfo.kalmanTracker.getActiveTrackers();
            if (trackers.length > 0) {
              // Use first tracker for now (simplification)
              trackerId = trackers[0];
              roomInfo.kalmanTracker.update(trackerId, detection);
            } else {
              // Initialize new tracker
              trackerId = roomInfo.kalmanTracker.initTracker(detection);
            }

            // Update confidence decay with detection
            roomInfo.confidenceDecay.update(detection, trackerId);
          } else {
            // No Kalman - just use confidence decay
            roomInfo.confidenceDecay.update(detection);
          }
        }

        console.log(`[CensorshipAgent] ${roomName} - Updated trackers: ${detections.length} detection(s)`);
      }
    }
  }

  /**
   * Log current status
   * @private
   */
  _logStatus(roomName) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    const batchStats = roomInfo.batchCollector.getStatus();
    const publishStats = roomInfo.livePublisher.getStats();
    const verifyStats = roomInfo.asyncVerifier.getStats();
    const trackingStats = KALMAN_ENABLED ? roomInfo.kalmanTracker.getStats() : null;
    const decayStats = roomInfo.confidenceDecay.getStats();

    console.log(`[CensorshipAgent] ${roomName} - Status @ frame ${roomInfo.frameCount}:`);
    console.log(`  Lane 1 (Publish): ${publishStats.framesPublished} frames, ${publishStats.avgLatencyMs.toFixed(2)}ms avg`);
    console.log(`  Lane 2 (Verify): Queue=${batchStats.queueDepth}, Pending=${batchStats.pendingBatches}, ${verifyStats.avgLatencyMs.toFixed(2)}ms avg`);
    console.log(`  Lane 3 (Track): Active trackers=${trackingStats?.activeTrackers || 0}, Blur regions=${decayStats.activeRegions}`);
  }

  /**
   * Disconnect agent from room
   */
  async disconnect(roomName) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) {
      return { success: true };
    }

    try {
      console.log(`[CensorshipAgent] Disconnecting from ${roomName}`);

      // Stop batch collector
      if (roomInfo.batchCollector) {
        await roomInfo.batchCollector.stop();
      }

      // Close verifier
      if (roomInfo.asyncVerifier) {
        await roomInfo.asyncVerifier.close();
      }

      // Close video stream
      if (roomInfo.videoStream) {
        roomInfo.videoStream.close();
      }

      // Close video source
      if (roomInfo.videoSource) {
        await roomInfo.videoSource.close();
      }

      // Close track
      if (roomInfo.censoredTrack) {
        await roomInfo.censoredTrack.close(false);
      }

      // Disconnect room
      await roomInfo.room.disconnect();

      // Get final stats
      const stats = {
        frameCount: roomInfo.frameCount,
        detectionCount: roomInfo.detectionCount,
        duration: Date.now() - roomInfo.startedAt.getTime(),
        publishStats: roomInfo.livePublisher.getStats(),
        verifyStats: roomInfo.asyncVerifier.getStats()
      };

      this._cleanup(roomName);

      return { success: true, stats };

    } catch (error) {
      console.error(`[CensorshipAgent] Error disconnecting from ${roomName}:`, error);
      this._cleanup(roomName);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cleanup room resources
   * @private
   */
  _cleanup(roomName) {
    this.activeRooms.delete(roomName);
    console.log(`[CensorshipAgent] Cleaned up ${roomName}`);
  }

  /**
   * Get status for room
   */
  getStatus(roomName) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return null;

    return {
      roomName,
      active: true,
      isProcessing: roomInfo.isProcessing,
      frameCount: roomInfo.frameCount,
      detectionCount: roomInfo.detectionCount,
      uptime: Date.now() - roomInfo.startedAt.getTime(),
      lanes: {
        lane1: roomInfo.livePublisher?.getStats(),
        lane2: roomInfo.asyncVerifier?.getStats(),
        lane3: {
          kalman: roomInfo.kalmanTracker?.getStats(),
          decay: roomInfo.confidenceDecay?.getStats()
        }
      }
    };
  }

  /**
   * Get all active rooms
   */
  getActiveRooms() {
    return Array.from(this.activeRooms.keys()).map(roomName =>
      this.getStatus(roomName)
    );
  }
}

// Singleton instance
const censorshipAgentHybrid = new CensorshipAgentHybrid();

export default censorshipAgentHybrid;
