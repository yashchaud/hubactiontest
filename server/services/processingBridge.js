/**
 * Processing Bridge Service
 * Connects LiveKit Ingress/Egress to RunPod GPU processing service
 * Handles frame extraction, processing, and reinjection
 */

import { EgressClient, IngressClient, AccessToken } from 'livekit-server-sdk';
import { EventEmitter } from 'events';
import censorshipProcessor from '../processors/contentCensorshipProcessor.js';
import frameExtractor from './frameExtractor.js';
import framePublisher from './framePublisher.js';
import axios from 'axios';

const LIVEKIT_HOST = process.env.LIVEKIT_WS_URL?.replace('wss://', 'https://') || 'https://localhost';

const egressClient = new EgressClient(
  LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

const ingressClient = new IngressClient(
  LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

class ProcessingBridge extends EventEmitter {
  constructor() {
    super();
    this.activeStreams = new Map();
    console.log('[ProcessingBridge] Initialized');
  }

  /**
   * Start processing for a stream
   * Initializes censorship session and starts server-side frame extraction
   */
  async startProcessing(roomName, censorshipConfig = {}) {
    if (this.activeStreams.has(roomName)) {
      throw new Error(`Processing already active for room: ${roomName}`);
    }

    try {
      console.log(`[ProcessingBridge] Starting processing for ${roomName}`);

      // Initialize censorship session
      const censorshipResult = await censorshipProcessor.initializeCensorship(
        roomName,
        censorshipConfig
      );

      if (!censorshipResult.success) {
        console.warn(`[ProcessingBridge] Censorship init failed: ${censorshipResult.error}`);
        // Return degraded mode - stream works but without censorship
        return {
          success: true,
          censorshipSessionId: null,
          degraded: true,
          error: censorshipResult.error
        };
      }

      // Store stream info
      const streamInfo = {
        roomName,
        censorshipSessionId: censorshipResult.sessionId,
        startedAt: new Date(),
        frameCount: 0,
        detectionCount: 0,
        lastProcessed: null,
        egressId: null,
        trackProcessingStarted: false
      };

      this.activeStreams.set(roomName, streamInfo);

      console.log(`[ProcessingBridge] Processing started for ${roomName}`);
      console.log(`  - Censorship Session: ${censorshipResult.sessionId}`);

      // Start frame publisher for processed stream re-injection
      try {
        const publisherInfo = await framePublisher.startPublishing(roomName, roomName);
        streamInfo.publisherInfo = publisherInfo;
        streamInfo.processedRoomName = publisherInfo.processedRoomName;

        console.log(`[ProcessingBridge] Frame publisher started for ${roomName}`);
        console.log(`  - Processed room: ${publisherInfo.processedRoomName}`);
      } catch (error) {
        console.error(`[ProcessingBridge] Failed to start frame publisher:`, error);
        // Continue without publisher - degraded mode
        streamInfo.publisherInfo = null;
      }

      // Listen for frame extractor events
      frameExtractor.on('detection', (data) => {
        if (data.roomName === roomName) {
          streamInfo.detectionCount += data.detections.length;
          this.emit('detection', data);
        }
      });

      frameExtractor.on('frame:extracted', (data) => {
        if (data.roomName === roomName) {
          streamInfo.frameCount = data.frameCount;
          streamInfo.lastProcessed = new Date();

          // Queue processed frame for publishing
          if (data.processedFrame && streamInfo.publisherInfo) {
            framePublisher.queueFrame(roomName, data.processedFrame);
          }
        }
      });

      this.emit('processing:started', streamInfo);

      return {
        success: true,
        censorshipSessionId: censorshipResult.sessionId,
        config: censorshipResult.config
      };

    } catch (error) {
      console.error('[ProcessingBridge] Error starting processing:', error);
      throw error;
    }
  }

  /**
   * Start track processing when broadcaster publishes video
   * Called from webhooks when video track is published
   */
  async startTrackProcessing(roomName, trackInfo) {
    const streamInfo = this.activeStreams.get(roomName);

    if (!streamInfo) {
      console.warn(`[ProcessingBridge] No active processing for ${roomName}, cannot start track processing`);
      return { success: false, error: 'No active processing session' };
    }

    if (streamInfo.trackProcessingStarted) {
      console.log(`[ProcessingBridge] Track processing already started for ${roomName}`);
      return { success: true, alreadyStarted: true };
    }

    try {
      console.log(`[ProcessingBridge] Starting track processing for ${roomName}`);
      console.log(`  - Track SID: ${trackInfo.sid}`);
      console.log(`  - Track type: ${trackInfo.type}`);
      console.log(`  - Track source: ${trackInfo.source}`);

      // Start frame extraction using Track Egress
      const extractionResult = await frameExtractor.startExtraction(
        roomName,
        trackInfo.sid,
        streamInfo.censorshipSessionId
      );

      streamInfo.trackProcessingStarted = true;
      streamInfo.egressId = extractionResult.egressId;

      console.log(`[ProcessingBridge] Track processing started for ${roomName}`);
      console.log(`  - Egress ID: ${extractionResult.egressId}`);

      this.emit('track:processing:started', {
        roomName,
        trackSid: trackInfo.sid,
        egressId: extractionResult.egressId
      });

      return {
        success: true,
        egressId: extractionResult.egressId
      };

    } catch (error) {
      console.error(`[ProcessingBridge] Error starting track processing for ${roomName}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create RTMP ingress for broadcaster to stream to
   */
  async _createRTMPIngress(roomName) {
    try {
      // Create RTMP ingress
      const ingress = await ingressClient.createIngress({
        inputType: 'RTMP_INPUT',
        name: `censorship-${roomName}`,
        roomName: roomName,
        participantIdentity: `broadcaster-${roomName}`,
        participantName: 'Broadcaster'
      });

      console.log(`[ProcessingBridge] Created RTMP ingress: ${ingress.ingressId}`);

      return {
        ingressId: ingress.ingressId,
        url: ingress.url,
        streamKey: ingress.streamKey
      };

    } catch (error) {
      console.error('[ProcessingBridge] Error creating RTMP ingress:', error);
      throw error;
    }
  }

  /**
   * Start track egress to extract frames for processing
   */
  async _startTrackEgress(roomName) {
    try {
      // Start track egress to get raw video frames
      // This will be used to extract frames and send to RunPod
      const egress = await egressClient.startTrackEgress(roomName, {
        // Track egress configuration
        // For now, we'll use track composite to get frames
      });

      console.log(`[ProcessingBridge] Started track egress: ${egress.egressId}`);

      return {
        egressId: egress.egressId,
        status: egress.status
      };

    } catch (error) {
      console.error('[ProcessingBridge] Error starting track egress:', error);
      throw error;
    }
  }

  /**
   * Process a frame from the stream
   * Called periodically to extract and process frames
   */
  async processFrame(roomName, frameBuffer) {
    const streamInfo = this.activeStreams.get(roomName);

    if (!streamInfo) {
      throw new Error(`No active processing for room: ${roomName}`);
    }

    try {
      // Send frame to censorship processor
      const result = await censorshipProcessor.processFrame(roomName, frameBuffer);

      // Update stream stats
      streamInfo.frameCount++;
      streamInfo.lastProcessed = new Date();

      if (result.detectionCount > 0) {
        streamInfo.detectionCount += result.detectionCount;

        this.emit('detection', {
          roomName,
          frameId: result.frameId,
          detections: result.detections,
          count: result.detectionCount
        });

        console.log(
          `[ProcessingBridge] ${roomName}: ${result.detectionCount} detection(s) in frame ${result.frameId}`
        );
      }

      return result;

    } catch (error) {
      console.error('[ProcessingBridge] Error processing frame:', error);
      throw error;
    }
  }

  /**
   * Process audio chunk
   */
  async processAudio(roomName, audioBuffer) {
    const streamInfo = this.activeStreams.get(roomName);

    if (!streamInfo) {
      throw new Error(`No active processing for room: ${roomName}`);
    }

    try {
      const result = await censorshipProcessor.processAudio(roomName, audioBuffer);

      if (result.profanityDetected) {
        this.emit('audio:profanity', {
          roomName,
          detections: result.detections
        });

        console.log(
          `[ProcessingBridge] ${roomName}: Audio profanity detected (${result.count} instance(s))`
        );
      }

      return result;

    } catch (error) {
      console.error('[ProcessingBridge] Error processing audio:', error);
      throw error;
    }
  }

  /**
   * Stop processing for a stream
   */
  async stopProcessing(roomName) {
    const streamInfo = this.activeStreams.get(roomName);

    if (!streamInfo) {
      console.log(`[ProcessingBridge] No active processing for ${roomName}`);
      return { success: true };
    }

    try {
      console.log(`[ProcessingBridge] Stopping processing for ${roomName}`);

      // Stop frame extraction if it was started
      if (streamInfo.trackProcessingStarted) {
        try {
          await frameExtractor.stopExtraction(roomName);
          console.log(`[ProcessingBridge] Stopped frame extraction for ${roomName}`);
        } catch (err) {
          console.error(`[ProcessingBridge] Error stopping frame extraction:`, err);
        }
      }

      // Stop frame publisher if it was started
      if (streamInfo.publisherInfo) {
        try {
          await framePublisher.stopPublishing(roomName);
          console.log(`[ProcessingBridge] Stopped frame publisher for ${roomName}`);
        } catch (err) {
          console.error(`[ProcessingBridge] Error stopping frame publisher:`, err);
        }
      }

      // End censorship session
      await censorshipProcessor.endCensorship(roomName);

      // Get final stats
      const stats = {
        roomName,
        duration: Date.now() - streamInfo.startedAt.getTime(),
        frameCount: streamInfo.frameCount,
        detectionCount: streamInfo.detectionCount,
        detectionRate: streamInfo.frameCount > 0
          ? ((streamInfo.detectionCount / streamInfo.frameCount) * 100).toFixed(2) + '%'
          : '0%',
        egressId: streamInfo.egressId
      };

      this.activeStreams.delete(roomName);

      console.log('[ProcessingBridge] Processing stopped:', stats);

      this.emit('processing:stopped', stats);

      return {
        success: true,
        stats
      };

    } catch (error) {
      console.error('[ProcessingBridge] Error stopping processing:', error);

      // Clean up anyway
      this.activeStreams.delete(roomName);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get processing status for a room
   */
  getStatus(roomName) {
    const streamInfo = this.activeStreams.get(roomName);

    if (!streamInfo) {
      return null;
    }

    return {
      roomName,
      active: true,
      censorshipSessionId: streamInfo.censorshipSessionId,
      startedAt: streamInfo.startedAt,
      frameCount: streamInfo.frameCount,
      detectionCount: streamInfo.detectionCount,
      lastProcessed: streamInfo.lastProcessed
    };
  }

  /**
   * Get all active processing streams
   */
  getActiveStreams() {
    return Array.from(this.activeStreams.keys()).map(roomName =>
      this.getStatus(roomName)
    );
  }

  /**
   * Update censorship configuration for a room
   */
  async updateCensorshipConfig(roomName, newConfig) {
    const streamInfo = this.activeStreams.get(roomName);

    if (!streamInfo) {
      throw new Error(`No active processing for room: ${roomName}`);
    }

    try {
      const result = await censorshipProcessor.updateConfig(roomName, newConfig);

      if (result.success) {
        streamInfo.censorshipSessionId = result.sessionId;
        console.log(`[ProcessingBridge] Updated censorship config for ${roomName}`);
      }

      return result;

    } catch (error) {
      console.error('[ProcessingBridge] Error updating censorship config:', error);
      throw error;
    }
  }
}

// Singleton instance
const processingBridge = new ProcessingBridge();

export default processingBridge;
