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
const PROCESSING_FPS = parseInt(process.env.PROCESSING_FPS) || 10; // Increased to 10 FPS for smoother censorship
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS) || 1000;

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
   * Uses LiveKit Stream output to extract frames via FFmpeg
   */
  async _startFFmpegExtraction(roomName, extractor) {
    console.log(`[FrameExtractor] ${roomName} - Starting FFmpeg frame extraction at ${PROCESSING_FPS} FPS`);

    // Start stream-based egress instead of file-based
    // This gives us real-time access to the stream
    try {
      // Update egress to use stream output
      const streamEgress = await egressClient.startTrackCompositeEgress(roomName, {
        stream: {
          protocol: StreamProtocol.RTMP,
          urls: [`rtmp://localhost/live/${roomName}`], // Local RTMP for processing
        },
        videoOnly: true,
      });

      extractor.streamEgressId = streamEgress.egressId;
      extractor.streamUrl = `rtmp://localhost/live/${roomName}`;

      console.log(`[FrameExtractor] ${roomName} - Stream egress started: ${streamEgress.egressId}`);

      // Wait a bit for stream to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Spawn FFmpeg to extract frames from RTMP stream
      const ffmpegArgs = [
        '-i', extractor.streamUrl,                    // Input RTMP stream
        '-vf', `fps=${PROCESSING_FPS}`,               // Extract at specified FPS
        '-f', 'image2pipe',                            // Output to pipe as images
        '-vcodec', 'mjpeg',                            // JPEG codec
        '-q:v', '5',                                   // Quality (2-31, lower is better)
        'pipe:1'                                       // Output to stdout
      ];

      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      extractor.ffmpegProcess = ffmpeg;

      let frameBuffer = Buffer.alloc(0);

      // Handle FFmpeg stdout (frame data)
      ffmpeg.stdout.on('data', async (data) => {
        frameBuffer = Buffer.concat([frameBuffer, data]);

        // JPEG markers: FFD8 (start) and FFD9 (end)
        const startMarker = frameBuffer.indexOf(Buffer.from([0xFF, 0xD8]));
        const endMarker = frameBuffer.indexOf(Buffer.from([0xFF, 0xD9]));

        if (startMarker !== -1 && endMarker !== -1 && endMarker > startMarker) {
          // Extract complete JPEG frame
          const frame = frameBuffer.slice(startMarker, endMarker + 2);
          frameBuffer = frameBuffer.slice(endMarker + 2);

          // Process frame
          await this._processExtractedFrame(roomName, extractor, frame);
        }
      });

      // Handle FFmpeg stderr (logs/errors)
      ffmpeg.stderr.on('data', (data) => {
        const message = data.toString();
        if (message.includes('error') || message.includes('Error')) {
          console.error(`[FrameExtractor] ${roomName} - FFmpeg error: ${message}`);
        }
      });

      // Handle FFmpeg exit
      ffmpeg.on('exit', (code, signal) => {
        console.log(`[FrameExtractor] ${roomName} - FFmpeg exited (code: ${code}, signal: ${signal})`);

        if (code !== 0 && code !== null) {
          console.error(`[FrameExtractor] ${roomName} - FFmpeg crashed, attempting restart...`);

          // Restart FFmpeg after delay if extractor still active
          if (this.activeExtractors.has(roomName)) {
            setTimeout(() => {
              if (this.activeExtractors.has(roomName)) {
                console.log(`[FrameExtractor] ${roomName} - Restarting FFmpeg...`);
                this._startFFmpegExtraction(roomName, extractor);
              }
            }, 3000);
          }
        }
      });

      console.log(`[FrameExtractor] ${roomName} - FFmpeg process started (PID: ${ffmpeg.pid})`);

    } catch (error) {
      console.error(`[FrameExtractor] ${roomName} - Error starting FFmpeg extraction:`, error);

      // Fallback to interval-based approach if stream fails
      console.log(`[FrameExtractor] ${roomName} - Falling back to file-based extraction`);
      extractor.extractionInterval = setInterval(async () => {
        await this._extractFrameFromEgress(roomName, extractor);
      }, 1000 / PROCESSING_FPS);
    }
  }

  /**
   * Process an extracted frame buffer
   * Sends to RunPod and handles response
   */
  async _processExtractedFrame(roomName, extractor, frameBuffer) {
    try {
      extractor.frameCount++;

      // Send to RunPod for processing
      const result = await this.sendFrameToRunPod(roomName, frameBuffer, extractor.censorshipSessionId);

      this.emit('frame:extracted', {
        roomName,
        frameCount: extractor.frameCount,
        detections: result.detections || [],
        processedFrame: result.processed_frame || null
      });

      if (result.detections && result.detections.length > 0) {
        console.log(`[FrameExtractor] ${roomName} - Frame ${extractor.frameCount}: ${result.detections.length} detection(s)`);
      }

      return result;

    } catch (error) {
      console.error(`[FrameExtractor] ${roomName} - Error processing frame ${extractor.frameCount}:`, error.message);

      // Emit error event for monitoring
      this.emit('frame:error', {
        roomName,
        frameCount: extractor.frameCount,
        error: error.message
      });

      return null;
    }
  }

  /**
   * Fallback: Extract a single frame from file-based egress
   * Used when stream-based extraction fails
   */
  async _extractFrameFromEgress(roomName, extractor) {
    try {
      // This is a fallback method that would read from the MP4 file
      // For now, just log that we're in fallback mode
      console.log(`[FrameExtractor] ${roomName} - Fallback extraction mode (frame ${extractor.frameCount})`);

      // In a full implementation, you would:
      // 1. Find the latest egress MP4 file
      // 2. Use FFmpeg to extract a frame from it
      // 3. Send to RunPod

      extractor.frameCount++;

      this.emit('frame:extracted', {
        roomName,
        frameCount: extractor.frameCount
      });

    } catch (error) {
      console.error(`[FrameExtractor] ${roomName} - Error in fallback extraction:`, error);
    }
  }

  /**
   * Send frame buffer to RunPod for processing with retry logic
   */
  async sendFrameToRunPod(roomName, frameBuffer, censorshipSessionId, retryCount = 0) {
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
          frameId: response.data.frame_id,
          processedFrame: response.data.processed_frame
        });
      }

      return response.data;

    } catch (error) {
      // Retry logic with exponential backoff
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
        console.warn(`[FrameExtractor] RunPod request failed (attempt ${retryCount + 1}/${MAX_RETRIES}), retrying in ${delay}ms...`);

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.sendFrameToRunPod(roomName, frameBuffer, censorshipSessionId, retryCount + 1);
      }

      console.error(`[FrameExtractor] Error sending frame to RunPod after ${MAX_RETRIES} retries:`, error.message);
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
