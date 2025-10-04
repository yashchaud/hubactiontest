/**
 * Censorship Agent - Server-Side Participant
 * Joins LiveKit room as participant, subscribes to broadcaster video,
 * processes frames through RunPod, applies censorship, and republishes
 */

import { Room, RoomEvent, Track, VideoPresets, LocalVideoTrack, setLogLevel, LogLevel } from 'livekit-client';
import { EventEmitter } from 'events';
import { createCanvas, loadImage } from 'canvas';
import axios from 'axios';
import FormData from 'form-data';
import { Readable } from 'stream';
import wrtc from '@roamhq/wrtc';
import { JSDOM } from 'jsdom';

// Reduce LiveKit logging to avoid wrtc errors
setLogLevel(LogLevel.warn);

// Configure LiveKit to use Node.js WebRTC and DOM
if (typeof window === 'undefined') {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');

  global.window = dom.window;
  global.document = dom.window.document;

  // Extend HTMLVideoElement to add play() method that returns a Promise
  const OriginalHTMLVideoElement = dom.window.HTMLVideoElement;
  class ExtendedHTMLVideoElement extends OriginalHTMLVideoElement {
    constructor() {
      super();
      this.srcObject = null;
      this.videoWidth = 0;
      this.videoHeight = 0;
    }
    play() {
      // Return a resolved promise for Node.js environment
      return Promise.resolve();
    }
    pause() {
      return Promise.resolve();
    }
  }

  global.HTMLVideoElement = ExtendedHTMLVideoElement;
  global.HTMLCanvasElement = dom.window.HTMLCanvasElement;

  // Override RTCPeerConnection with wrtc implementation
  global.window.RTCPeerConnection = wrtc.RTCPeerConnection;
  global.window.RTCIceCandidate = wrtc.RTCIceCandidate;
  global.window.RTCSessionDescription = wrtc.RTCSessionDescription;

  global.RTCPeerConnection = wrtc.RTCPeerConnection;
  global.RTCIceCandidate = wrtc.RTCIceCandidate;
  global.RTCSessionDescription = wrtc.RTCSessionDescription;

  // Patch RTCRtpReceiver to provide getStats stub (not implemented in wrtc)
  const OriginalRTCPeerConnection = wrtc.RTCPeerConnection;
  class PatchedRTCPeerConnection extends OriginalRTCPeerConnection {
    getReceivers() {
      const receivers = super.getReceivers();
      // Patch each receiver to provide getStats stub
      return receivers.map(receiver => {
        if (!receiver.getStats) {
          receiver.getStats = async () => {
            // Return empty stats to prevent crashes
            return new Map();
          };
        }
        return receiver;
      });
    }
  }

  global.window.RTCPeerConnection = PatchedRTCPeerConnection;
  global.RTCPeerConnection = PatchedRTCPeerConnection;

  // Add MediaStream polyfill
  global.MediaStream = wrtc.MediaStream || class MediaStream {
    constructor() {
      this.id = Math.random().toString(36);
      this.active = true;
      this.tracks = [];
    }
    getTracks() { return this.tracks; }
    getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
    getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
    addTrack(track) { this.tracks.push(track); }
    removeTrack(track) {
      const index = this.tracks.indexOf(track);
      if (index > -1) this.tracks.splice(index, 1);
    }
  };

  // Define navigator
  if (!global.navigator) {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'node',
        mediaDevices: {}
      },
      writable: true,
      configurable: true
    });
  }
}

const RUNPOD_SERVICE_URL = process.env.RUNPOD_SERVICE_URL || 'http://localhost:8000';
const PROCESSING_FPS = parseInt(process.env.AGENT_FRAME_RATE) || 10;
const CENSORSHIP_MODE = process.env.AGENT_CENSORSHIP_MODE || 'blur';
const FRAME_QUALITY = 0.7; // JPEG quality (0.5-0.9 recommended for balance)
const MAX_CONCURRENT_REQUESTS = 2; // Limit concurrent RunPod requests to prevent overload

class CensorshipAgent extends EventEmitter {
  constructor() {
    super();
    this.activeRooms = new Map(); // roomName -> room info
    console.log('[CensorshipAgent] Initialized');
    console.log(`[CensorshipAgent] Processing FPS: ${PROCESSING_FPS}`);
    console.log(`[CensorshipAgent] Censorship mode: ${CENSORSHIP_MODE}`);
  }

  /**
   * Connect agent to a LiveKit room
   * @param {string} roomName - Room to join
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
        censoredTrackPublication: null,
        processingInterval: null,
        frameCount: 0,
        detectionCount: 0,
        lastFrame: null,
        isProcessing: false,
        startedAt: new Date(),
        pendingRequests: 0, // Track concurrent RunPod requests
        lastProcessedTime: 0, // Track last frame processing time for rate limiting
        skippedFrames: 0 // Track frames skipped due to rate limiting
      };

      this.activeRooms.set(roomName, roomInfo);

      // Handle track subscriptions
      room.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
        await this._handleTrackSubscribed(roomName, track, publication, participant);
      });

      // Handle data received (for frame data from broadcaster)
      room.on(RoomEvent.DataReceived, async (payload, participant, kind, topic) => {
        await this._handleDataReceived(roomName, payload, participant);
      });

      // Handle disconnection
      room.on(RoomEvent.Disconnected, () => {
        console.log(`[CensorshipAgent] Disconnected from ${roomName}`);
        this.activeRooms.delete(roomName);
      });

      // Connect to room
      await room.connect(wsUrl, token);
      console.log(`[CensorshipAgent] Connected to ${roomName} as ${room.localParticipant.identity}`);

      // Start monitoring for broadcaster track
      this._startTrackMonitoring(roomName);

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
   * Monitor room for broadcaster track and start processing
   */
  _startTrackMonitoring(roomName) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    // Check for existing broadcaster tracks
    const participants = Array.from(roomInfo.room.remoteParticipants.values());
    for (const participant of participants) {
      const videoTracks = Array.from(participant.videoTrackPublications.values());
      for (const publication of videoTracks) {
        if (publication.track) {
          this._handleTrackSubscribed(
            roomName,
            publication.track,
            publication,
            participant
          );
        }
      }
    }
  }

  /**
   * Handle new track subscription
   */
  async _handleTrackSubscribed(roomName, track, publication, participant) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    // Only process video tracks from broadcaster
    if (track.kind !== Track.Kind.Video) {
      console.log(`[CensorshipAgent] ${roomName} - Ignoring non-video track`);
      return;
    }

    if (!participant.identity.includes('broadcaster')) {
      console.log(`[CensorshipAgent] ${roomName} - Ignoring non-broadcaster track`);
      return;
    }

    console.log(`[CensorshipAgent] ${roomName} - Subscribed to broadcaster video track`);
    console.log(`  - Participant: ${participant.identity}`);
    console.log(`  - Track: ${track.sid}`);

    roomInfo.broadcasterTrack = track;

    // Start frame processing
    await this._startFrameProcessing(roomName);
  }

  /**
   * Start processing frames from broadcaster track
   */
  async _startFrameProcessing(roomName) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo || !roomInfo.broadcasterTrack) {
      console.warn(`[CensorshipAgent] Cannot start processing for ${roomName} - no track`);
      return;
    }

    if (roomInfo.isProcessing) {
      console.log(`[CensorshipAgent] Already processing ${roomName}`);
      return;
    }

    roomInfo.isProcessing = true;
    console.log(`[CensorshipAgent] Starting frame processing for ${roomName} at ${PROCESSING_FPS} FPS`);

    // Get native MediaStreamTrack from LiveKit track
    const mediaStreamTrack = roomInfo.broadcasterTrack.mediaStreamTrack;

    if (!mediaStreamTrack) {
      console.error(`[CensorshipAgent] No mediaStreamTrack available for ${roomName}`);
      roomInfo.isProcessing = false;
      return;
    }

    // Create MediaStream from track for processing
    const mediaStream = new MediaStream([mediaStreamTrack]);
    roomInfo.mediaStream = mediaStream;

    // Set up frame capture using canvas and ImageCapture API (Node.js compatible approach)
    // Since we're in Node.js, we'll use a different approach with RTCPeerConnection to get frames
    await this._setupFrameCapture(roomName, mediaStreamTrack);

    this.emit('processing:started', { roomName, fps: PROCESSING_FPS });
  }

  /**
   * Set up frame capture from MediaStreamTrack using RTCPeerConnection
   * This method sets up a receiver to get raw video frames from the track
   */
  async _setupFrameCapture(roomName, mediaStreamTrack) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    try {
      // For Node.js server-side processing, we need to use a different approach
      // We'll create a dummy canvas and poll the track settings to get dimensions
      const settings = mediaStreamTrack.getSettings ? mediaStreamTrack.getSettings() : {};
      const width = settings.width || 640;
      const height = settings.height || 480;

      console.log(`[CensorshipAgent] ${roomName} - Track dimensions: ${width}x${height}`);

      roomInfo.trackSettings = { width, height };
      roomInfo.canvas = createCanvas(width, height);

      // Start processing loop
      // Since we can't directly access video frames in Node.js without a video element,
      // we'll use an alternative approach: request frames via data channel from client
      // OR use a workaround with MediaStreamTrackProcessor if available

      // Fallback: Use interval-based processing with frame requests
      const intervalMs = 1000 / PROCESSING_FPS;
      roomInfo.processingInterval = setInterval(async () => {
        await this._captureAndProcessFrame(roomName);
      }, intervalMs);

      console.log(`[CensorshipAgent] ${roomName} - Frame capture initialized`);

    } catch (error) {
      console.error(`[CensorshipAgent] ${roomName} - Error setting up frame capture:`, error);
      roomInfo.isProcessing = false;
    }
  }

  /**
   * Capture and process a single frame
   * In Node.js environment, we need to work around the lack of video element
   */
  async _captureAndProcessFrame(roomName) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo || !roomInfo.broadcasterTrack) return;

    try {
      const mediaStreamTrack = roomInfo.broadcasterTrack.mediaStreamTrack;

      // Check if track is still active
      if (mediaStreamTrack.readyState !== 'live') {
        console.warn(`[CensorshipAgent] ${roomName} - Track not live (${mediaStreamTrack.readyState})`);
        return;
      }

      // For Node.js, we need to use a creative workaround
      // Option 1: Use node-canvas with a mock video frame
      // Option 2: Request frames via RTCRtpReceiver (requires access to peer connection)
      // Option 3: Signal client to send frames via data channel (most reliable for server-side)

      // For now, we'll implement Option 3: Request frame from broadcaster via data channel
      // The broadcaster will capture their own frame and send it to us

      // Send frame request via data channel
      await this._requestFrameFromBroadcaster(roomName);

    } catch (error) {
      // Don't log every error to avoid spam
      if (roomInfo.frameCount % 100 === 0) {
        console.error(`[CensorshipAgent] ${roomName} - Error capturing frame:`, error.message);
      }
    }
  }

  /**
   * Request frame data from broadcaster via data channel
   * This is the most reliable way to get frames server-side
   */
  async _requestFrameFromBroadcaster(roomName) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo || !roomInfo.room) return;

    try {
      // Send frame request via data channel
      const request = {
        type: 'frame_request',
        timestamp: Date.now(),
        requestId: roomInfo.frameCount
      };

      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(request));

      await roomInfo.room.localParticipant.publishData(data, {
        reliable: false, // Use unreliable for real-time
        destinationIdentities: [roomInfo.broadcasterTrack.sid]  // Send only to broadcaster
      });

    } catch (error) {
      // Silently fail - broadcaster might not support frame requests
    }
  }

  /**
   * Process a received frame buffer (called when broadcaster sends frame data)
   */
  async _processReceivedFrame(roomName, frameBuffer) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    try {
      const now = Date.now();
      const minFrameInterval = 1000 / PROCESSING_FPS; // Minimum time between frames

      // Rate limiting: Skip frame if processing too fast
      if (now - roomInfo.lastProcessedTime < minFrameInterval) {
        roomInfo.skippedFrames++;
        if (roomInfo.skippedFrames % 100 === 0) {
          console.log(`[CensorshipAgent] ${roomName} - Rate limiting: ${roomInfo.skippedFrames} frames skipped`);
        }
        return;
      }

      // Concurrency limiting: Skip frame if too many pending requests
      if (roomInfo.pendingRequests >= MAX_CONCURRENT_REQUESTS) {
        roomInfo.skippedFrames++;
        return;
      }

      roomInfo.frameCount++;
      roomInfo.lastFrame = { buffer: frameBuffer, timestamp: now };
      roomInfo.lastProcessedTime = now;
      roomInfo.pendingRequests++;

      // Send to RunPod for detection (non-blocking)
      const detections = await this._sendToRunPod(roomInfo.censorshipSessionId, frameBuffer);

      roomInfo.pendingRequests--;

      if (detections && detections.length > 0) {
        roomInfo.detectionCount += detections.length;
        console.log(`[CensorshipAgent] ${roomName} - Frame ${roomInfo.frameCount}: ${detections.length} detection(s) (pending: ${roomInfo.pendingRequests})`);

        // Load image and apply censorship
        const image = await loadImage(frameBuffer);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);

        // Apply censorship
        await this._applyCensorship(canvas, ctx, detections);

        // Emit detection event
        this.emit('detection', {
          roomName,
          frameCount: roomInfo.frameCount,
          detections,
          timestamp: now
        });

        // Publish censored frame
        await this._publishCensoredFrame(roomName, canvas);
      }

    } catch (error) {
      // Decrement pending requests on error
      if (roomInfo) {
        roomInfo.pendingRequests = Math.max(0, roomInfo.pendingRequests - 1);
      }
      console.error(`[CensorshipAgent] ${roomName} - Error processing frame:`, error.message);
    }
  }

  /**
   * Send frame to RunPod for detection
   */
  async _sendToRunPod(sessionId, frameBuffer) {
    try {
      const formData = new FormData();
      formData.append('frame_data', frameBuffer, {
        filename: 'frame.jpg',
        contentType: 'image/jpeg'
      });

      const response = await axios.post(
        `${RUNPOD_SERVICE_URL}/process/frame`,
        formData,
        {
          params: { session_id: sessionId },
          headers: formData.getHeaders(),
          timeout: 5000,
          maxContentLength: 100 * 1024 * 1024
        }
      );

      return response.data.detections || [];
    } catch (error) {
      // Don't log every error, just count them
      return [];
    }
  }

  /**
   * Apply censorship to canvas based on detections
   */
  async _applyCensorship(canvas, ctx, detections) {
    for (const detection of detections) {
      const { bbox, type } = detection;
      if (!bbox) continue;

      const [x, y, width, height] = bbox;

      switch (CENSORSHIP_MODE) {
        case 'blur':
          // Apply blur effect
          this._applyBlur(ctx, x, y, width, height);
          break;
        case 'pixelate':
          // Apply pixelation
          this._applyPixelate(ctx, x, y, width, height);
          break;
        case 'overlay':
          // Apply solid overlay
          ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
          ctx.fillRect(x, y, width, height);
          break;
      }
    }
  }

  /**
   * Apply blur effect to region
   */
  _applyBlur(ctx, x, y, width, height) {
    // Get image data for region
    const imageData = ctx.getImageData(x, y, width, height);
    const pixels = imageData.data;

    // Simple box blur
    const blurRadius = 10;
    const tempCanvas = createCanvas(width, height);
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(imageData, 0, 0);

    // Apply multiple blur passes
    tempCtx.filter = `blur(${blurRadius}px)`;
    tempCtx.drawImage(tempCanvas, 0, 0);

    // Put blurred data back
    ctx.putImageData(tempCtx.getImageData(0, 0, width, height), x, y);
  }

  /**
   * Apply pixelation effect to region
   */
  _applyPixelate(ctx, x, y, width, height) {
    const pixelSize = 10;
    const imageData = ctx.getImageData(x, y, width, height);

    // Downsample and upsample for pixelation effect
    for (let py = 0; py < height; py += pixelSize) {
      for (let px = 0; px < width; px += pixelSize) {
        const i = (py * width + px) * 4;
        const avgColor = [
          imageData.data[i],
          imageData.data[i + 1],
          imageData.data[i + 2]
        ];

        // Fill pixel block
        ctx.fillStyle = `rgb(${avgColor[0]}, ${avgColor[1]}, ${avgColor[2]})`;
        ctx.fillRect(x + px, y + py, pixelSize, pixelSize);
      }
    }
  }

  /**
   * Publish censored frame via data channel
   * Optimized to reduce latency with quality/size tradeoffs
   */
  async _publishCensoredFrame(roomName, canvas) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo || !roomInfo.room) return;

    try {
      // Convert to JPEG with optimized quality setting
      const frameBuffer = canvas.toBuffer('image/jpeg', { quality: FRAME_QUALITY });

      // Encode censored frame as base64 for transmission
      const censoredFrameData = {
        type: 'censored_frame',
        timestamp: Date.now(),
        frameNumber: roomInfo.frameCount,
        frame: frameBuffer.toString('base64')
      };

      // Send via data channel to all participants
      // Use unreliable delivery for lower latency (real-time video tolerates some loss)
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(censoredFrameData));

      await roomInfo.room.localParticipant.publishData(data, {
        reliable: false, // Unreliable for lower latency
        destinationIdentities: [] // Broadcast to all viewers
      });

    } catch (error) {
      console.error(`[CensorshipAgent] ${roomName} - Error publishing censored frame:`, error.message);
    }
  }

  /**
   * Handle incoming data from participants
   */
  async _handleDataReceived(roomName, payload, participant) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return;

    try {
      // Decode data
      const decoder = new TextDecoder();
      const message = JSON.parse(decoder.decode(payload));

      // Handle different message types
      if (message.type === 'frame_data' && participant.identity.includes('broadcaster')) {
        // Received frame data from broadcaster
        // Decode base64 frame
        const frameBuffer = Buffer.from(message.frame, 'base64');
        await this._processReceivedFrame(roomName, frameBuffer);
      }

    } catch (error) {
      // Likely binary data or non-JSON, ignore
    }
  }

  /**
   * Disconnect agent from room
   */
  async disconnect(roomName) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) {
      console.log(`[CensorshipAgent] Not connected to ${roomName}`);
      return { success: true };
    }

    try {
      console.log(`[CensorshipAgent] Disconnecting from ${roomName}`);

      // Stop processing
      if (roomInfo.processingInterval) {
        clearInterval(roomInfo.processingInterval);
      }

      // Disconnect from room
      await roomInfo.room.disconnect();

      const stats = {
        roomName,
        duration: Date.now() - roomInfo.startedAt.getTime(),
        framesProcessed: roomInfo.frameCount,
        detectionsFound: roomInfo.detectionCount
      };

      this.activeRooms.delete(roomName);

      console.log(`[CensorshipAgent] Disconnected from ${roomName}`);
      console.log(`  - Frames processed: ${stats.framesProcessed}`);
      console.log(`  - Detections: ${stats.detectionsFound}`);

      this.emit('disconnected', stats);

      return {
        success: true,
        stats
      };

    } catch (error) {
      console.error(`[CensorshipAgent] Error disconnecting from ${roomName}:`, error);
      this.activeRooms.delete(roomName);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get status for a room
   */
  getStatus(roomName) {
    const roomInfo = this.activeRooms.get(roomName);
    if (!roomInfo) return null;

    return {
      roomName,
      connected: roomInfo.room.state === 'connected',
      isProcessing: roomInfo.isProcessing,
      framesProcessed: roomInfo.frameCount,
      detectionsFound: roomInfo.detectionCount,
      fps: PROCESSING_FPS,
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
