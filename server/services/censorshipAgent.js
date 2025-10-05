/**
 * Censorship Agent Service
 * Server-side LiveKit participant that subscribes to broadcaster video,
 * processes frames for content detection, and publishes censored output
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
  VideoFrame,
  TrackPublishOptions,
  TrackSource
} from '@livekit/rtc-node';
import FormData from 'form-data';
import axios from 'axios';
import { Readable } from 'stream';
import { EventEmitter } from 'events';
import { createCanvas } from 'canvas';

const RUNPOD_SERVICE_URL = process.env.RUNPOD_SERVICE_URL || 'http://localhost:8000';
const PROCESSING_FPS = parseInt(process.env.AGENT_FRAME_RATE) || 10;
const CENSORSHIP_MODE = process.env.AGENT_CENSORSHIP_MODE || 'blur';

/**
 * Censorship Agent - Server-side participant for content moderation
 */
class CensorshipAgent extends EventEmitter {
  constructor() {
    super();
    this.activeRooms = new Map(); // roomName -> roomInfo
    console.log('[CensorshipAgent] Initialized with @livekit/rtc-node');
    console.log(`[CensorshipAgent] Processing FPS: ${PROCESSING_FPS}`);
    console.log(`[CensorshipAgent] Censorship mode: ${CENSORSHIP_MODE}`);
    console.log(`[CensorshipAgent] RunPod URL: ${RUNPOD_SERVICE_URL}`);
  }

  /**
   * Connect agent to room as server-side participant
   * @param {string} roomName - Room to connect to
   * @param {string} wsUrl - LiveKit WebSocket URL
   * @param {string} token - Access token for agent participant
   * @param {string} censorshipSessionId - RunPod session ID
   */
  async connect(roomName, wsUrl, token, censorshipSessionId) {
    if (this.activeRooms.has(roomName)) {
      console.log(`[CensorshipAgent] Already connected to ${roomName}`);
      return this.activeRooms.get(roomName);
    }

    try {
      console.log(`[CensorshipAgent] Connecting to room: ${roomName}`);

      const room = new Room();

      const roomInfo = {
        roomName,
        room,
        censorshipSessionId,
        broadcasterTrack: null,
        videoStream: null,
        videoSource: null,  // VideoSource for publishing censored frames
        censoredTrack: null,  // Published censored video track
        frameCount: 0,
        detectionCount: 0,
        startedAt: new Date(),
        processingTask: null,
        isProcessing: false,
        frameWidth: 0,  // Will be set when we get first frame
        frameHeight: 0,
        lastDetections: null,  // Store detections for predictive censoring
        lastDetectionTime: 0
      };

      this.activeRooms.set(roomName, roomInfo);

      // Handle track published - manually subscribe to broadcaster video only
      room.on(RoomEvent.TrackPublished, async (publication, participant) => {
        console.log(`[CensorshipAgent] ${roomName} - Track published by ${participant.identity}: kind=${publication.kind}`);

        // Note: In @livekit/rtc-node, kind values are: 1 = AUDIO, 2 = VIDEO
        if (participant.identity.includes('broadcaster') && publication.kind === 2) {
          console.log(`[CensorshipAgent] ${roomName} - Subscribing to broadcaster video track`);
          publication.setSubscribed(true);
        } else if (publication.kind === 1) {
          console.log(`[CensorshipAgent] ${roomName} - Skipping audio track (not needed)`);
          publication.setSubscribed(false);
        }
      });

      // Handle track subscribed - start processing video frames
      room.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
        await this._handleTrackSubscribed(roomName, track, publication, participant);
      });

      // Handle disconnection
      room.on(RoomEvent.Disconnected, () => {
        console.log(`[CensorshipAgent] Disconnected from ${roomName}`);
        this._cleanup(roomName);
      });

      // Connect to room with manual subscription control
      await room.connect(wsUrl, token, {
        autoSubscribe: false  // Manually control what we subscribe to
      });

      console.log(`[CensorshipAgent] Connected to ${roomName} as ${room.localParticipant.identity}`);

      // Check for existing broadcaster tracks
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
   * Check for existing broadcaster tracks in the room
   * Note: In @livekit/rtc-node, tracks are usually subscribed via TrackPublished event
   * This method is kept for compatibility but may not find existing tracks immediately after connect
   */
  async _checkExistingTracks(roomName) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    try {
      // Skip if remoteParticipants not available yet
      if (!roomInfo.room.remoteParticipants) {
        console.log(`[CensorshipAgent] ${roomName} - Waiting for TrackPublished events to subscribe`);
        return;
      }

      const participants = Array.from(roomInfo.room.remoteParticipants.values());

      if (participants.length === 0) {
        console.log(`[CensorshipAgent] ${roomName} - No participants yet, will subscribe via TrackPublished event`);
        return;
      }

      console.log(`[CensorshipAgent] ${roomName} - Checking ${participants.length} existing participant(s)`);

      for (const participant of participants) {
        if (!participant.identity.includes('broadcaster')) {
          continue;
        }

        console.log(`[CensorshipAgent] ${roomName} - Found broadcaster: ${participant.identity}`);

        // Discover the API structure
        console.log(`[CensorshipAgent] ${roomName} - Participant properties:`, Object.keys(participant));

        // Try different possible APIs for track publications
        if (participant.trackPublications) {
          console.log(`[CensorshipAgent] ${roomName} - trackPublications type:`, typeof participant.trackPublications);
          console.log(`[CensorshipAgent] ${roomName} - trackPublications keys:`, Object.keys(participant.trackPublications));

          // Try iterating as Map
          if (participant.trackPublications instanceof Map) {
            console.log(`[CensorshipAgent] ${roomName} - trackPublications is a Map with ${participant.trackPublications.size} entries`);
            for (const [sid, publication] of participant.trackPublications) {
              console.log(`[CensorshipAgent] ${roomName} - Track publication:`, {
                sid,
                kind: publication.kind,
                source: publication.source,
                subscribed: publication.subscribed
              });

              // Note: In @livekit/rtc-node, kind values are:
              // 1 = AUDIO, 2 = VIDEO (different from browser SDK!)
              // Subscribe to video tracks only (kind === 2)
              if (publication.kind === 2 && !publication.subscribed) {
                console.log(`[CensorshipAgent] ${roomName} - Subscribing to existing video track: ${sid}`);
                publication.setSubscribed(true);
              } else if (publication.kind === 1) {
                console.log(`[CensorshipAgent] ${roomName} - Skipping audio track: ${sid}`);
                publication.setSubscribed(false);
              }
            }
          }
          // Try iterating as Object
          else {
            const pubs = Object.values(participant.trackPublications);
            console.log(`[CensorshipAgent] ${roomName} - trackPublications is an Object with ${pubs.length} entries`);
            for (const publication of pubs) {
              console.log(`[CensorshipAgent] ${roomName} - Track publication:`, {
                sid: publication.sid,
                kind: publication.kind,
                source: publication.source,
                subscribed: publication.subscribed
              });

              // Subscribe to video tracks only
              if (publication.kind === 'video' && !publication.subscribed) {
                console.log(`[CensorshipAgent] ${roomName} - Subscribing to existing video track: ${publication.sid}`);
                publication.setSubscribed(true);
              } else if (publication.kind === 'audio') {
                console.log(`[CensorshipAgent] ${roomName} - Skipping audio track: ${publication.sid}`);
                publication.setSubscribed(false);
              }
            }
          }
        } else {
          console.log(`[CensorshipAgent] ${roomName} - No trackPublications property found`);
        }
      }
    } catch (error) {
      // Fail gracefully - tracks will be subscribed via TrackPublished event
      console.log(`[CensorshipAgent] ${roomName} - Will subscribe to tracks via TrackPublished event`);
    }
  }

  /**
   * Handle track subscription
   */
  async _handleTrackSubscribed(roomName, track, publication, participant) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    console.log(`[CensorshipAgent] ${roomName} - Track subscribed: kind=${track.kind}, TrackKind.KIND_VIDEO=${TrackKind.KIND_VIDEO}`);

    // Only process video tracks from broadcaster
    // In @livekit/rtc-node: KIND_VIDEO = 2, KIND_AUDIO = 1
    if (track.kind !== TrackKind.KIND_VIDEO) {
      console.log(`[CensorshipAgent] ${roomName} - Ignoring non-video track (kind=${track.kind}) from ${participant.identity}`);
      return;
    }

    if (!participant.identity.includes('broadcaster')) {
      console.log(`[CensorshipAgent] ${roomName} - Ignoring video track from non-broadcaster: ${participant.identity}`);
      return;
    }

    console.log(`[CensorshipAgent] ${roomName} - Subscribed to broadcaster video track`);
    console.log(`  - Participant: ${participant.identity}`);
    console.log(`  - Track: ${publication.trackSid}`);

    roomInfo.broadcasterTrack = track;

    // Initialize VideoSource immediately (assume 1280x720, will adjust if needed)
    // This ensures we can publish censored frames right away
    try {
      await this._initializeVideoSource(roomName, 1280, 720);
      console.log(`[CensorshipAgent] ${roomName} - VideoSource pre-initialized`);
    } catch (error) {
      console.error(`[CensorshipAgent] ${roomName} - Error pre-initializing VideoSource:`, error.message);
    }

    // Start processing video stream
    await this._startVideoProcessing(roomName, track);
  }

  /**
   * Start processing video frames from track
   */
  async _startVideoProcessing(roomName, track) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    if (roomInfo.isProcessing) {
      console.log(`[CensorshipAgent] ${roomName} - Already processing video`);
      return;
    }

    roomInfo.isProcessing = true;
    console.log(`[CensorshipAgent] Starting frame processing for ${roomName} at ${PROCESSING_FPS} FPS`);

    // Create video stream
    const videoStream = new VideoStream(track);
    roomInfo.videoStream = videoStream;

    // Start async frame processing task
    roomInfo.processingTask = this._processVideoStream(roomName, videoStream);

    // Emit event
    this.emit('processing:started', { roomName, fps: PROCESSING_FPS });
  }

  /**
   * Process video stream frames
   * Publishes all frames at 30 FPS, but only sends every Nth frame for detection
   */
  async _processVideoStream(roomName, videoStream) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    // Detection happens at PROCESSING_FPS (e.g., 5 FPS)
    // Publishing happens for ALL frames (30 FPS)
    const PUBLISH_FPS = 30;
    const DETECTION_SAMPLE_RATE = Math.floor(PUBLISH_FPS / PROCESSING_FPS); // e.g., 30/5 = 6 (detect every 6th frame)

    let framesSinceLastDetection = 0;
    let pendingProcessing = 0;
    const MAX_PENDING = 1; // Max concurrent RunPod requests (only 1 to prevent overwhelming NudeNet)

    try {
      console.log(`[CensorshipAgent] ${roomName} - Starting frame loop`);
      console.log(`[CensorshipAgent] ${roomName} - Publishing: 30 FPS, Detection: ${PROCESSING_FPS} FPS (every ${DETECTION_SAMPLE_RATE} frames)`);

      for await (const event of videoStream) {
        // Check if room still active
        if (!this.activeRooms.has(roomName)) {
          console.log(`[CensorshipAgent] ${roomName} - Room no longer active, stopping processing`);
          break;
        }

        const frame = event.frame;
        roomInfo.frameCount++;
        framesSinceLastDetection++;

        // Publish ALL frames (maintains 30 FPS)
        await this._publishFrameWithCensoring(roomName, frame);

        // Only send to RunPod for detection every Nth frame
        const shouldDetect = framesSinceLastDetection >= DETECTION_SAMPLE_RATE;
        const hasCapacity = pendingProcessing < MAX_PENDING;

        if (shouldDetect && hasCapacity) {
          framesSinceLastDetection = 0;

          // Log periodically
          if (roomInfo.frameCount <= 10 || roomInfo.frameCount % 150 === 0) {
            console.log(`[CensorshipAgent] ${roomName} - Detecting frame #${roomInfo.frameCount} (${frame.width}x${frame.height})`);
          }

          // Send to RunPod for detection (fire-and-forget)
          pendingProcessing++;
          this._detectFrameAsync(roomName, frame, roomInfo.frameCount)
            .finally(() => {
              pendingProcessing--;
            });
        } else if (shouldDetect && !hasCapacity) {
          // Reset counter but skip detection due to backpressure
          framesSinceLastDetection = 0;
          if (roomInfo.frameCount % 30 === 0) {
            console.log(`[CensorshipAgent] ${roomName} - Skipping detection (RunPod busy)`);
          }
        }
      }

      console.log(`[CensorshipAgent] ${roomName} - Frame loop ended (processed ${roomInfo.frameCount} frames)`);

    } catch (error) {
      console.error(`[CensorshipAgent] ${roomName} - Video stream error:`, error);
    } finally {
      // Wait for pending processing to complete
      while (pendingProcessing > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      videoStream.close();
      roomInfo.isProcessing = false;
      console.log(`[CensorshipAgent] ${roomName} - Processing stopped`);
    }
  }

  /**
   * Publish frame with censoring applied (based on previous detections)
   */
  async _publishFrameWithCensoring(roomName, frame) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo || !roomInfo.videoSource) return;

    try {
      // Use previous detection results for predictive censoring
      if (roomInfo.lastDetections && roomInfo.lastDetections.length > 0) {
        // Apply blur based on last detection
        await this._publishCensoredFrame(roomName, frame, roomInfo.lastDetections);
      } else {
        // No recent detections - publish original
        await this._publishOriginalFrame(roomName, frame);
      }
    } catch (error) {
      // Silently fail to avoid spam
    }
  }

  /**
   * Send frame to RunPod for detection (async)
   */
  async _detectFrameAsync(roomName, frame, frameNumber) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    try {
      // Convert frame to JPEG and send to RunPod
      const buffer = await this._convertFrameToJPEG(frame);
      const detections = await this._sendToRunPod(roomInfo.censorshipSessionId, buffer);

      if (detections && detections.length > 0) {
        roomInfo.detectionCount += detections.length;

        // Log first few and periodically
        if (frameNumber <= 10 || frameNumber % 150 === 0) {
          console.log(`[CensorshipAgent] ${roomName} - Frame ${frameNumber}: ${detections.length} detection(s) - CENSORING NEXT FRAMES`);
        }

        // Emit detection event
        this.emit('detection', {
          roomName,
          frameNumber,
          detections
        });

        // Store for future frames
        roomInfo.lastDetections = detections;
        roomInfo.lastDetectionTime = Date.now();
      } else {
        // Clear detections if none found
        roomInfo.lastDetections = null;
      }

    } catch (error) {
      // Only log errors occasionally to avoid spam
      if (frameNumber <= 10 || frameNumber % 150 === 0) {
        console.error(`[CensorshipAgent] ${roomName} - Error detecting frame ${frameNumber}:`, error.message);
      }
    }
  }

  /**
   * Convert VideoFrame to JPEG buffer
   * Resizes to max 640px width to reduce processing time
   */
  async _convertFrameToJPEG(frame) {
    let rgbaFrame = null;
    let tempCanvas = null;
    let canvas = null;

    try {
      // Convert to RGBA buffer type
      rgbaFrame = frame.convert(VideoBufferType.RGBA);

      // Calculate scaled dimensions (max 480px width for lower memory usage)
      const MAX_WIDTH = 480;
      let targetWidth = frame.width;
      let targetHeight = frame.height;

      if (frame.width > MAX_WIDTH) {
        const scale = MAX_WIDTH / frame.width;
        targetWidth = MAX_WIDTH;
        targetHeight = Math.round(frame.height * scale);
      }

      // Create temporary canvas at original size
      tempCanvas = createCanvas(frame.width, frame.height);
      const tempCtx = tempCanvas.getContext('2d');

      // Create ImageData from RGBA buffer
      const imageData = tempCtx.createImageData(frame.width, frame.height);
      const rgbaData = new Uint8ClampedArray(rgbaFrame.data);
      imageData.data.set(rgbaData);
      tempCtx.putImageData(imageData, 0, 0);

      // Create output canvas at target size
      canvas = createCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d');

      // Draw scaled image
      ctx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);

      // Convert canvas to JPEG buffer (lower quality to save memory)
      const jpegBuffer = canvas.toBuffer('image/jpeg', { quality: 0.6 });

      return jpegBuffer;
    } catch (error) {
      console.error('[CensorshipAgent] Error converting frame to JPEG:', error);
      throw error;
    } finally {
      // Clean up memory
      if (rgbaFrame) {
        rgbaFrame = null;
      }
      tempCanvas = null;
      canvas = null;

      // Force garbage collection hint
      if (global.gc) {
        global.gc();
      }
    }
  }

  /**
   * Send frame to RunPod for detection
   */
  async _sendToRunPod(sessionId, frameBuffer) {
    try {
      const formData = new FormData();

      // Convert buffer to stream for FormData
      const stream = new Readable();
      stream.push(frameBuffer);
      stream.push(null);

      formData.append('frame_data', stream, {
        filename: 'frame.jpg',
        contentType: 'image/jpeg',
        knownLength: frameBuffer.length
      });

      const response = await axios.post(
        `${RUNPOD_SERVICE_URL}/process/frame`,
        formData,
        {
          params: { session_id: sessionId },
          headers: formData.getHeaders(),
          timeout: 30000, // 30 seconds for model warmup and processing
          maxContentLength: 100 * 1024 * 1024
        }
      );

      return response.data.detections || [];
    } catch (error) {
      // Silently fail for individual frames to avoid log spam
      if (error.response?.status !== 500) {
        console.error('[CensorshipAgent] RunPod request failed:', error.message);
      }
      return [];
    }
  }

  /**
   * Initialize VideoSource and publish censored video track
   */
  async _initializeVideoSource(roomName, width, height) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    try {
      console.log(`[CensorshipAgent] ${roomName} - Initializing VideoSource (${width}x${height})`);

      // Create VideoSource for publishing censored frames
      roomInfo.videoSource = new VideoSource(width, height);

      // Create LocalVideoTrack from the source
      const track = LocalVideoTrack.createVideoTrack('censored-video', roomInfo.videoSource);

      // Configure publish options
      const options = new TrackPublishOptions();
      options.source = TrackSource.TRACK_SOURCE_CAMERA;

      // Publish the censored video track
      const publication = await roomInfo.room.localParticipant.publishTrack(track, options);
      roomInfo.censoredTrack = track;

      console.log(`[CensorshipAgent] ${roomName} - Published censored video track: ${publication.trackSid}`);

      // Emit event
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
   * Publish original frame (no detections)
   */
  async _publishOriginalFrame(roomName, frame) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo || !roomInfo.videoSource) return;

    try {
      // Capture the original frame to the VideoSource
      roomInfo.videoSource.captureFrame(frame);
    } catch (error) {
      // Silently fail to avoid log spam
    }
  }

  /**
   * Apply blur to detected regions and publish censored frame
   */
  async _publishCensoredFrame(roomName, frame, detections) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo || !roomInfo.videoSource) return;

    let rgbaFrame = null;
    let canvas = null;

    try {
      // Convert frame to RGBA
      rgbaFrame = frame.convert(VideoBufferType.RGBA);

      // Create canvas for manipulation
      canvas = createCanvas(frame.width, frame.height);
      const ctx = canvas.getContext('2d');

      // Put original image on canvas
      const imageData = ctx.createImageData(frame.width, frame.height);
      imageData.data.set(new Uint8ClampedArray(rgbaFrame.data));
      ctx.putImageData(imageData, 0, 0);

      // Apply blur to each detected region
      for (const detection of detections) {
        const { box, class: detectedClass } = detection;
        if (box) {
          // Coordinates are normalized [0-1], convert to pixels
          const x = Math.floor(box[0] * frame.width);
          const y = Math.floor(box[1] * frame.height);
          const w = Math.floor(box[2] * frame.width);
          const h = Math.floor(box[3] * frame.height);

          // Extract the region
          const regionData = ctx.getImageData(x, y, w, h);

          // Apply strong blur effect (pixelation)
          const pixelSize = 20;
          for (let py = 0; py < h; py += pixelSize) {
            for (let px = 0; px < w; px += pixelSize) {
              // Get average color of pixelSize x pixelSize block
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

          // Put blurred region back
          ctx.putImageData(regionData, x, y);
        }
      }

      // Get the censored image data
      const censoredData = ctx.getImageData(0, 0, frame.width, frame.height);

      // Create new VideoFrame from censored data
      const censoredFrame = new VideoFrame(
        new Uint8Array(censoredData.data.buffer),
        frame.width,
        frame.height,
        VideoBufferType.RGBA
      );

      // Publish the censored frame
      roomInfo.videoSource.captureFrame(censoredFrame);

    } catch (error) {
      console.error(`[CensorshipAgent] ${roomName} - Error applying censorship:`, error.message);
      // Fallback to publishing original frame
      try {
        roomInfo.videoSource.captureFrame(frame);
      } catch (fallbackError) {
        // Silently fail
      }
    } finally {
      // Cleanup
      rgbaFrame = null;
      canvas = null;
      if (global.gc) {
        global.gc();
      }
    }
  }

  /**
   * Disconnect agent from room
   */
  async disconnect(roomName) {
    const roomInfo = this.activeRooms.get(roomName);

    if (!roomInfo) {
      console.log(`[CensorshipAgent] No active connection for ${roomName}`);
      return { success: true };
    }

    try {
      console.log(`[CensorshipAgent] Disconnecting from ${roomName}`);

      // Close video stream
      if (roomInfo.videoStream) {
        roomInfo.videoStream.close();
      }

      // Close video source
      if (roomInfo.videoSource) {
        await roomInfo.videoSource.close();
      }

      // Close censored track
      if (roomInfo.censoredTrack) {
        await roomInfo.censoredTrack.close(false); // Don't close source, already closed above
      }

      // Disconnect from room
      await roomInfo.room.disconnect();

      // Calculate stats
      const stats = {
        frameCount: roomInfo.frameCount,
        detectionCount: roomInfo.detectionCount,
        duration: Date.now() - roomInfo.startedAt.getTime()
      };

      this._cleanup(roomName);

      return {
        success: true,
        stats
      };

    } catch (error) {
      console.error(`[CensorshipAgent] Error disconnecting from ${roomName}:`, error);
      this._cleanup(roomName);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Cleanup room resources
   */
  _cleanup(roomName) {
    this.activeRooms.delete(roomName);
    console.log(`[CensorshipAgent] Cleaned up resources for ${roomName}`);
  }

  /**
   * Get status for a room
   */
  getStatus(roomName) {
    const roomInfo = this.activeRooms.get(roomName);

    if (!roomInfo) {
      return null;
    }

    return {
      roomName,
      active: true,
      isProcessing: roomInfo.isProcessing,
      frameCount: roomInfo.frameCount,
      detectionCount: roomInfo.detectionCount,
      uptime: Date.now() - roomInfo.startedAt.getTime()
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
const censorshipAgent = new CensorshipAgent();

export default censorshipAgent;
