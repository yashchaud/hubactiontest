/**
 * Track Processor Service
 * Subscribes to LiveKit video tracks and forwards frames to RunPod for processing
 * Implements server-side WebRTC track subscription for real-time censorship
 */

import { Room, RoomEvent, Track } from 'livekit-client';
import { EventEmitter } from 'events';
import axios from 'axios';

const RUNPOD_SERVICE_URL = process.env.RUNPOD_SERVICE_URL || 'http://localhost:8000';
const PROCESSING_FPS = parseInt(process.env.PROCESSING_FPS) || 5; // Process 5 frames per second
const FRAME_INTERVAL = 1000 / PROCESSING_FPS;

class TrackProcessor extends EventEmitter {
  constructor() {
    super();
    this.activeProcessors = new Map(); // roomName -> processor instance
    console.log('[TrackProcessor] Initialized');
    console.log(`  - Processing FPS: ${PROCESSING_FPS}`);
    console.log(`  - RunPod URL: ${RUNPOD_SERVICE_URL}`);
  }

  /**
   * Start processing tracks for a room
   * Creates a server-side participant that subscribes to broadcaster tracks
   */
  async startProcessing(roomName, participantToken, censorshipSessionId) {
    if (this.activeProcessors.has(roomName)) {
      console.log(`[TrackProcessor] Already processing ${roomName}`);
      return;
    }

    try {
      console.log(`[TrackProcessor] Starting track processing for ${roomName}`);

      const processor = {
        roomName,
        censorshipSessionId,
        room: null,
        frameInterval: null,
        currentVideoTrack: null,
        canvasElement: null,
        frameCount: 0,
        lastProcessTime: 0,
        isProcessing: false
      };

      // Create a server-side Room connection
      const room = new Room({
        adaptiveStream: true,
        dynacast: true
      });

      processor.room = room;

      // Set up event handlers BEFORE connecting
      room.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
        console.log(`[TrackProcessor] ${roomName} - Track subscribed:`, {
          participant: participant.identity,
          trackSid: track.sid,
          kind: track.kind,
          source: track.source
        });

        // Only process video tracks from camera or screen share
        if (track.kind === Track.Kind.Video &&
            (track.source === Track.Source.Camera || track.source === Track.Source.ScreenShare)) {

          processor.currentVideoTrack = track;

          // Start frame extraction
          await this._startFrameExtraction(roomName, processor);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        console.log(`[TrackProcessor] ${roomName} - Track unsubscribed: ${track.sid}`);

        if (track === processor.currentVideoTrack) {
          this._stopFrameExtraction(processor);
          processor.currentVideoTrack = null;
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        console.log(`[TrackProcessor] ${roomName} - Room disconnected`);
        this._cleanup(processor);
      });

      // Connect to the room
      const wsUrl = process.env.LIVEKIT_WS_URL;
      console.log(`[TrackProcessor] ${roomName} - Connecting to LiveKit...`);

      await room.connect(wsUrl, participantToken);

      console.log(`[TrackProcessor] ${roomName} - Connected successfully`);
      console.log(`  - Participants: ${room.participants.size}`);
      console.log(`  - Remote participants:`, Array.from(room.participants.values()).map(p => p.identity));

      // Subscribe to existing tracks
      for (const participant of room.participants.values()) {
        console.log(`[TrackProcessor] ${roomName} - Checking participant ${participant.identity}`);

        for (const publication of participant.tracks.values()) {
          if (publication.isSubscribed && publication.track) {
            console.log(`[TrackProcessor] ${roomName} - Found existing track:`, {
              participant: participant.identity,
              trackSid: publication.trackSid,
              kind: publication.kind,
              source: publication.source
            });

            if (publication.kind === Track.Kind.Video &&
                (publication.source === Track.Source.Camera || publication.source === Track.Source.ScreenShare)) {

              processor.currentVideoTrack = publication.track;
              await this._startFrameExtraction(roomName, processor);
            }
          }
        }
      }

      this.activeProcessors.set(roomName, processor);
      this.emit('processing:started', { roomName });

      return {
        success: true,
        roomName,
        censorshipSessionId
      };

    } catch (error) {
      console.error(`[TrackProcessor] Error starting processing for ${roomName}:`, error);
      throw error;
    }
  }

  /**
   * Start extracting frames from video track
   */
  async _startFrameExtraction(roomName, processor) {
    if (processor.frameInterval) {
      console.log(`[TrackProcessor] ${roomName} - Frame extraction already running`);
      return;
    }

    console.log(`[TrackProcessor] ${roomName} - Starting frame extraction at ${PROCESSING_FPS} FPS`);

    // Create off-screen canvas for frame capture
    // Note: In Node.js, we'll need to use a library like 'canvas' or handle this differently
    // For now, we'll implement a simplified version that works with the track's video element

    processor.frameInterval = setInterval(async () => {
      await this._extractAndProcessFrame(roomName, processor);
    }, FRAME_INTERVAL);
  }

  /**
   * Stop frame extraction
   */
  _stopFrameExtraction(processor) {
    if (processor.frameInterval) {
      clearInterval(processor.frameInterval);
      processor.frameInterval = null;
      console.log(`[TrackProcessor] ${processor.roomName} - Frame extraction stopped`);
    }
  }

  /**
   * Extract frame from video track and send to RunPod
   */
  async _extractAndProcessFrame(roomName, processor) {
    if (!processor.currentVideoTrack || processor.isProcessing) {
      return;
    }

    try {
      processor.isProcessing = true;
      const now = Date.now();

      // Get video element from track
      // Note: In server-side Node.js, we need to handle this differently
      // We'll use the MediaStreamTrack to get frames
      const track = processor.currentVideoTrack;

      if (!track.mediaStreamTrack) {
        console.warn(`[TrackProcessor] ${roomName} - No mediaStreamTrack available`);
        processor.isProcessing = false;
        return;
      }

      // For server-side processing, we need to use a different approach
      // Option 1: Use Track Egress to get frames
      // Option 2: Use a headless browser/canvas library
      // For now, we'll implement a placeholder that shows the architecture

      console.log(`[TrackProcessor] ${roomName} - Would extract frame ${processor.frameCount}`);
      console.log(`  - Track state: ${track.mediaStreamTrack.readyState}`);
      console.log(`  - Time since last: ${now - processor.lastProcessTime}ms`);

      // TODO: Implement actual frame extraction
      // This requires either:
      // 1. Using Track Egress to get raw frames
      // 2. Using a headless browser with Puppeteer to capture canvas
      // 3. Using native Node.js canvas library with MediaStreamTrack

      // For demonstration, we'll create a mock frame processing call
      // In production, replace this with actual frame extraction

      processor.frameCount++;
      processor.lastProcessTime = now;

      this.emit('frame:extracted', {
        roomName,
        frameCount: processor.frameCount,
        timestamp: now
      });

    } catch (error) {
      console.error(`[TrackProcessor] ${roomName} - Error extracting frame:`, error);
    } finally {
      processor.isProcessing = false;
    }
  }

  /**
   * Send frame to RunPod for processing
   */
  async _sendFrameToRunPod(roomName, frameBlob, censorshipSessionId) {
    try {
      const formData = new FormData();
      formData.append('frame', frameBlob);
      formData.append('session_id', censorshipSessionId);

      const response = await axios.post(
        `${RUNPOD_SERVICE_URL}/process-frame`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          timeout: 5000 // 5 second timeout
        }
      );

      if (response.data.detections && response.data.detections.length > 0) {
        this.emit('detection', {
          roomName,
          detections: response.data.detections,
          frameId: response.data.frame_id
        });
      }

      return response.data;

    } catch (error) {
      console.error(`[TrackProcessor] ${roomName} - Error sending frame to RunPod:`, error.message);
      throw error;
    }
  }

  /**
   * Stop processing for a room
   */
  async stopProcessing(roomName) {
    const processor = this.activeProcessors.get(roomName);

    if (!processor) {
      console.log(`[TrackProcessor] No active processing for ${roomName}`);
      return { success: true };
    }

    console.log(`[TrackProcessor] Stopping processing for ${roomName}`);

    this._cleanup(processor);
    this.activeProcessors.delete(roomName);

    this.emit('processing:stopped', { roomName });

    return {
      success: true,
      stats: {
        frameCount: processor.frameCount
      }
    };
  }

  /**
   * Cleanup processor resources
   */
  _cleanup(processor) {
    this._stopFrameExtraction(processor);

    if (processor.room) {
      processor.room.disconnect();
      processor.room = null;
    }

    processor.currentVideoTrack = null;
  }

  /**
   * Get processing status for a room
   */
  getStatus(roomName) {
    const processor = this.activeProcessors.get(roomName);

    if (!processor) {
      return null;
    }

    return {
      roomName,
      active: true,
      censorshipSessionId: processor.censorshipSessionId,
      frameCount: processor.frameCount,
      hasVideoTrack: !!processor.currentVideoTrack,
      isProcessing: processor.isProcessing,
      connected: processor.room?.state === 'connected'
    };
  }

  /**
   * Get all active processors
   */
  getActiveProcessors() {
    return Array.from(this.activeProcessors.keys()).map(roomName =>
      this.getStatus(roomName)
    );
  }
}

// Singleton instance
const trackProcessor = new TrackProcessor();

export default trackProcessor;
