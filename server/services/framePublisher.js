/**
 * Frame Publisher Service
 * Publishes processed (censored) frames back to LiveKit for viewers
 * Uses RTMP ingress to inject processed video stream
 */

import { IngressClient, IngressInput } from 'livekit-server-sdk';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';

const LIVEKIT_HOST = process.env.LIVEKIT_WS_URL?.replace('wss://', 'https://') || 'https://localhost';
const PUBLISHING_FPS = parseInt(process.env.PUBLISHING_FPS) || 10;

const ingressClient = new IngressClient(
  LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

class FramePublisher extends EventEmitter {
  constructor() {
    super();
    this.activePublishers = new Map(); // roomName -> publisher info
    this.frameQueues = new Map(); // roomName -> frame queue
    console.log('[FramePublisher] Initialized');
  }

  /**
   * Start publishing processed frames to a LiveKit room
   * Creates RTMP ingress and publishes via FFmpeg
   */
  async startPublishing(roomName, rawRoomName) {
    if (this.activePublishers.has(roomName)) {
      console.log(`[FramePublisher] Already publishing for ${roomName}`);
      return this.activePublishers.get(roomName);
    }

    try {
      console.log(`[FramePublisher] Starting publisher for ${roomName}`);
      console.log(`  - Source: ${rawRoomName}`);
      console.log(`  - Target: processed-${roomName}`);

      // Create RTMP ingress for the processed room
      const ingress = await ingressClient.createIngress(IngressInput.RTMP_INPUT, {
        name: `processed-${roomName}`,
        roomName: `processed-${roomName}`,
        participantIdentity: `censored-stream-${roomName}`,
        participantName: 'Censored Stream',
        bypassTranscoding: false, // Enable transcoding for better compatibility
      });

      console.log(`[FrameExtractor] Created RTMP ingress: ${ingress.ingressId}`);
      console.log(`  - RTMP URL: ${ingress.url}`);
      console.log(`  - Stream Key: ${ingress.streamKey}`);

      // Initialize frame queue for buffering
      const frameQueue = [];
      this.frameQueues.set(roomName, frameQueue);

      // Create publisher info
      const publisher = {
        roomName,
        rawRoomName,
        processedRoomName: `processed-${roomName}`,
        ingressId: ingress.ingressId,
        rtmpUrl: ingress.url,
        streamKey: ingress.streamKey,
        ffmpegProcess: null,
        frameQueue,
        publishedFrames: 0,
        droppedFrames: 0,
        lastPublishTime: Date.now(),
        isPublishing: false
      };

      this.activePublishers.set(roomName, publisher);

      // Start FFmpeg process to publish frames
      await this._startFFmpegPublisher(publisher);

      // Start frame publishing loop
      this._startPublishingLoop(publisher);

      return publisher;

    } catch (error) {
      console.error(`[FramePublisher] Error starting publisher for ${roomName}:`, error);
      throw error;
    }
  }

  /**
   * Start FFmpeg process to publish frames to RTMP
   */
  async _startFFmpegPublisher(publisher) {
    const { rtmpUrl, streamKey } = publisher;

    console.log(`[FramePublisher] ${publisher.roomName} - Starting FFmpeg publisher`);

    // FFmpeg arguments for RTMP streaming
    const ffmpegArgs = [
      '-f', 'image2pipe',                          // Input from pipe
      '-framerate', `${PUBLISHING_FPS}`,           // Input frame rate
      '-i', 'pipe:0',                              // Read from stdin
      '-c:v', 'libx264',                           // H.264 codec
      '-preset', 'veryfast',                       // Fast encoding
      '-tune', 'zerolatency',                      // Optimize for low latency
      '-pix_fmt', 'yuv420p',                       // Pixel format
      '-g', `${PUBLISHING_FPS * 2}`,               // GOP size (keyframe interval)
      '-b:v', '2000k',                             // Bitrate
      '-maxrate', '2500k',                         // Max bitrate
      '-bufsize', '5000k',                         // Buffer size
      '-f', 'flv',                                 // FLV format for RTMP
      `${rtmpUrl}/${streamKey}`                    // RTMP destination
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    publisher.ffmpegProcess = ffmpeg;

    // Handle FFmpeg stderr (logs)
    ffmpeg.stderr.on('data', (data) => {
      const message = data.toString();
      if (message.includes('error') || message.includes('Error')) {
        console.error(`[FramePublisher] ${publisher.roomName} - FFmpeg error: ${message.substring(0, 200)}`);
      }
    });

    // Handle FFmpeg exit
    ffmpeg.on('exit', (code, signal) => {
      console.log(`[FramePublisher] ${publisher.roomName} - FFmpeg exited (code: ${code}, signal: ${signal})`);

      if (code !== 0 && code !== null && this.activePublishers.has(publisher.roomName)) {
        console.error(`[FramePublisher] ${publisher.roomName} - FFmpeg crashed, attempting restart...`);

        // Restart FFmpeg after delay
        setTimeout(() => {
          if (this.activePublishers.has(publisher.roomName)) {
            console.log(`[FramePublisher] ${publisher.roomName} - Restarting FFmpeg publisher...`);
            this._startFFmpegPublisher(publisher);
          }
        }, 3000);
      }
    });

    publisher.isPublishing = true;
    console.log(`[FramePublisher] ${publisher.roomName} - FFmpeg publisher started (PID: ${ffmpeg.pid})`);
  }

  /**
   * Start loop to publish queued frames
   */
  _startPublishingLoop(publisher) {
    const publishInterval = 1000 / PUBLISHING_FPS;

    publisher.publishLoop = setInterval(() => {
      this._publishNextFrame(publisher);
    }, publishInterval);
  }

  /**
   * Publish next frame from queue
   */
  _publishNextFrame(publisher) {
    if (!publisher.isPublishing || !publisher.ffmpegProcess) {
      return;
    }

    const frame = publisher.frameQueue.shift();

    if (!frame) {
      // No frames in queue - could publish last frame or skip
      return;
    }

    try {
      // Write frame to FFmpeg stdin
      const written = publisher.ffmpegProcess.stdin.write(frame);

      if (written) {
        publisher.publishedFrames++;
        publisher.lastPublishTime = Date.now();

        this.emit('frame:published', {
          roomName: publisher.roomName,
          frameCount: publisher.publishedFrames,
          queueSize: publisher.frameQueue.length
        });
      } else {
        // FFmpeg backpressure - frame dropped
        publisher.droppedFrames++;
        console.warn(`[FramePublisher] ${publisher.roomName} - Frame dropped (backpressure)`);
      }
    } catch (error) {
      console.error(`[FramePublisher] ${publisher.roomName} - Error publishing frame:`, error.message);
    }
  }

  /**
   * Add processed frame to publishing queue
   * @param {string} roomName - Room name
   * @param {Buffer|string} frameData - Frame buffer or base64 string
   */
  queueFrame(roomName, frameData) {
    const publisher = this.activePublishers.get(roomName);

    if (!publisher) {
      console.warn(`[FramePublisher] No active publisher for ${roomName}`);
      return false;
    }

    // Convert base64 to buffer if needed
    let frameBuffer;
    if (typeof frameData === 'string') {
      frameBuffer = Buffer.from(frameData, 'base64');
    } else {
      frameBuffer = frameData;
    }

    // Queue management - drop oldest frames if queue too large
    const MAX_QUEUE_SIZE = 30; // ~3 seconds at 10 FPS

    if (publisher.frameQueue.length >= MAX_QUEUE_SIZE) {
      publisher.frameQueue.shift(); // Drop oldest frame
      publisher.droppedFrames++;
      console.warn(`[FramePublisher] ${publisher.roomName} - Queue full, dropped oldest frame`);
    }

    publisher.frameQueue.push(frameBuffer);

    return true;
  }

  /**
   * Stop publishing for a room
   */
  async stopPublishing(roomName) {
    const publisher = this.activePublishers.get(roomName);

    if (!publisher) {
      console.log(`[FramePublisher] No active publisher for ${roomName}`);
      return { success: true };
    }

    try {
      console.log(`[FramePublisher] Stopping publisher for ${roomName}`);

      // Stop publishing loop
      if (publisher.publishLoop) {
        clearInterval(publisher.publishLoop);
      }

      // Stop FFmpeg
      if (publisher.ffmpegProcess) {
        publisher.ffmpegProcess.stdin.end();
        publisher.ffmpegProcess.kill('SIGTERM');
      }

      // Delete ingress
      if (publisher.ingressId) {
        try {
          await ingressClient.deleteIngress(publisher.ingressId);
          console.log(`[FramePublisher] Deleted ingress: ${publisher.ingressId}`);
        } catch (err) {
          console.error(`[FramePublisher] Error deleting ingress:`, err.message);
        }
      }

      const stats = {
        publishedFrames: publisher.publishedFrames,
        droppedFrames: publisher.droppedFrames,
        finalQueueSize: publisher.frameQueue.length
      };

      this.activePublishers.delete(roomName);
      this.frameQueues.delete(roomName);

      this.emit('publishing:stopped', { roomName, stats });

      return {
        success: true,
        stats
      };

    } catch (error) {
      console.error(`[FramePublisher] Error stopping publisher:`, error);
      this.activePublishers.delete(roomName);
      this.frameQueues.delete(roomName);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get publisher status
   */
  getStatus(roomName) {
    const publisher = this.activePublishers.get(roomName);

    if (!publisher) {
      return null;
    }

    return {
      roomName,
      processedRoomName: publisher.processedRoomName,
      active: publisher.isPublishing,
      ingressId: publisher.ingressId,
      publishedFrames: publisher.publishedFrames,
      droppedFrames: publisher.droppedFrames,
      queueSize: publisher.frameQueue.length,
      lastPublishTime: publisher.lastPublishTime
    };
  }

  /**
   * Get all active publishers
   */
  getActivePublishers() {
    return Array.from(this.activePublishers.keys()).map(roomName =>
      this.getStatus(roomName)
    );
  }
}

// Singleton instance
const framePublisher = new FramePublisher();

export default framePublisher;
