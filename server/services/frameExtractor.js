/**
 * Frame Extractor Service
 * Extracts frames from LiveKit tracks using Track Egress
 * Sends frames to RunPod for processing
 */

import { EgressClient, EncodedFileType, StreamProtocol } from 'livekit-server-sdk';
import { EventEmitter } from 'events';
import axios from 'axios';
import FormData from 'form-data';
import { spawn } from 'child_process';
import { createWriteStream, createReadStream, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const LIVEKIT_HOST = process.env.LIVEKIT_WS_URL?.replace('wss://', 'https://') || 'https://localhost';
const RUNPOD_SERVICE_URL = process.env.RUNPOD_SERVICE_URL || 'http://localhost:8000';
const PROCESSING_FPS = parseInt(process.env.PROCESSING_FPS) || 5;

const egressClient = new EgressClient(
  LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

class FrameExtractor extends EventEmitter {
  constructor() {
    super();
    this.activeExtractors = new Map(); // roomName -> extractor info
    console.log('[FrameExtractor] Initialized');
  }

  /**
   * Start extracting frames from a room's video tracks
   * Uses WebSocket or HLS stream from Track Egress
   */
  async startExtraction(roomName, trackSid, censorshipSessionId) {
    if (this.activeExtractors.has(roomName)) {
      console.log(`[FrameExtractor] Already extracting for ${roomName}`);
      return;
    }

    try {
      console.log(`[FrameExtractor] Starting frame extraction for ${roomName}`);
      console.log(`  - Track SID: ${trackSid}`);

      // Start track composite egress with file output
      // This will give us a stream we can extract frames from
      const egress = await egressClient.startTrackCompositeEgress(roomName, {
        file: {
          filepath: join(tmpdir(), `livekit-${roomName}-{time}.mp4`),
          fileType: EncodedFileType.MP4,
        },
        videoOnly: true, // We only need video for frame extraction
      });

      console.log(`[FrameExtractor] Started egress: ${egress.egressId}`);

      const extractor = {
        roomName,
        trackSid,
        censorshipSessionId,
        egressId: egress.egressId,
        frameCount: 0,
        detectionCount: 0,
        ffmpegProcess: null,
        streamUrl: null
      };

      this.activeExtractors.set(roomName, extractor);

      // Start frame extraction process
      await this._startFFmpegExtraction(roomName, extractor);

      return {
        success: true,
        egressId: egress.egressId
      };

    } catch (error) {
      console.error(`[FrameExtractor] Error starting extraction for ${roomName}:`, error);
      throw error;
    }
  }

  /**
   * Alternative approach: Start extraction using WebSocket stream
   * This provides real-time frame access without file-based egress
   */
  async startWebSocketExtraction(roomName, participantIdentity, censorshipSessionId) {
    try {
      console.log(`[FrameExtractor] Starting WebSocket extraction for ${roomName}`);

      // Start track egress with WebSocket stream output
      const egress = await egressClient.startTrackEgress(roomName, {
        track: {
          trackId: participantIdentity,
        },
        websocket: {
          url: `${RUNPOD_SERVICE_URL}/ws/stream/${censorshipSessionId}`,
        },
      });

      console.log(`[FrameExtractor] Started WebSocket egress: ${egress.egressId}`);

      const extractor = {
        roomName,
        censorshipSessionId,
        egressId: egress.egressId,
        frameCount: 0,
        detectionCount: 0,
        type: 'websocket'
      };

      this.activeExtractors.set(roomName, extractor);

      return {
        success: true,
        egressId: egress.egressId
      };

    } catch (error) {
      console.error(`[FrameExtractor] Error starting WebSocket extraction:`, error);
      throw error;
    }
  }

  /**
   * Start FFmpeg process to extract frames from stream
   */
  async _startFFmpegExtraction(roomName, extractor) {
    // Note: This is a simplified implementation
    // In production, you would:
    // 1. Wait for egress to start streaming
    // 2. Use FFmpeg to extract frames at specified FPS
    // 3. Send each frame to RunPod for processing

    console.log(`[FrameExtractor] ${roomName} - Starting FFmpeg frame extraction`);

    // For now, we'll use a simpler approach with periodic screenshots
    // This will be implemented in the next phase

    extractor.extractionInterval = setInterval(async () => {
      await this._extractFrameFromEgress(roomName, extractor);
    }, 1000 / PROCESSING_FPS);
  }

  /**
   * Extract a single frame and send to RunPod
   */
  async _extractFrameFromEgress(roomName, extractor) {
    try {
      // In production, this would:
      // 1. Read frame from egress stream
      // 2. Convert to JPEG/PNG
      // 3. Send to RunPod

      extractor.frameCount++;

      console.log(`[FrameExtractor] ${roomName} - Extracted frame ${extractor.frameCount}`);

      this.emit('frame:extracted', {
        roomName,
        frameCount: extractor.frameCount
      });

    } catch (error) {
      console.error(`[FrameExtractor] ${roomName} - Error extracting frame:`, error);
    }
  }

  /**
   * Send frame buffer to RunPod for processing
   */
  async sendFrameToRunPod(roomName, frameBuffer, censorshipSessionId) {
    try {
      const formData = new FormData();
      formData.append('frame', frameBuffer, {
        filename: 'frame.jpg',
        contentType: 'image/jpeg'
      });
      formData.append('session_id', censorshipSessionId);

      const response = await axios.post(
        `${RUNPOD_SERVICE_URL}/censorship/process-frame`,
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 5000,
          maxBodyLength: Infinity
        }
      );

      const extractor = this.activeExtractors.get(roomName);
      if (extractor && response.data.detections?.length > 0) {
        extractor.detectionCount += response.data.detections.length;

        this.emit('detection', {
          roomName,
          detections: response.data.detections,
          frameId: response.data.frame_id
        });
      }

      return response.data;

    } catch (error) {
      console.error(`[FrameExtractor] Error sending frame to RunPod:`, error.message);
      throw error;
    }
  }

  /**
   * Stop extraction for a room
   */
  async stopExtraction(roomName) {
    const extractor = this.activeExtractors.get(roomName);

    if (!extractor) {
      console.log(`[FrameExtractor] No active extraction for ${roomName}`);
      return { success: true };
    }

    try {
      console.log(`[FrameExtractor] Stopping extraction for ${roomName}`);

      // Stop extraction interval
      if (extractor.extractionInterval) {
        clearInterval(extractor.extractionInterval);
      }

      // Stop FFmpeg process if running
      if (extractor.ffmpegProcess) {
        extractor.ffmpegProcess.kill('SIGTERM');
      }

      // Stop LiveKit egress
      if (extractor.egressId) {
        try {
          await egressClient.stopEgress(extractor.egressId);
          console.log(`[FrameExtractor] Stopped egress: ${extractor.egressId}`);
        } catch (err) {
          console.error(`[FrameExtractor] Error stopping egress:`, err.message);
        }
      }

      const stats = {
        frameCount: extractor.frameCount,
        detectionCount: extractor.detectionCount
      };

      this.activeExtractors.delete(roomName);

      this.emit('extraction:stopped', { roomName, stats });

      return {
        success: true,
        stats
      };

    } catch (error) {
      console.error(`[FrameExtractor] Error stopping extraction:`, error);
      this.activeExtractors.delete(roomName);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get extraction status
   */
  getStatus(roomName) {
    const extractor = this.activeExtractors.get(roomName);

    if (!extractor) {
      return null;
    }

    return {
      roomName,
      active: true,
      egressId: extractor.egressId,
      censorshipSessionId: extractor.censorshipSessionId,
      frameCount: extractor.frameCount,
      detectionCount: extractor.detectionCount
    };
  }

  /**
   * Get all active extractors
   */
  getActiveExtractors() {
    return Array.from(this.activeExtractors.keys()).map(roomName =>
      this.getStatus(roomName)
    );
  }
}

// Singleton instance
const frameExtractor = new FrameExtractor();

export default frameExtractor;
