/**
 * Content Censorship Processor
 * Coordinates with RunPod GPU service for real-time content censorship
 */

import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import FormData from 'form-data';

class ContentCensorshipProcessor {
  constructor() {
    this.runpodServiceUrl = process.env.RUNPOD_SERVICE_URL || 'http://localhost:8000';
    this.activeSessions = new Map();
    this.enabled = process.env.ENABLE_CENSORSHIP === 'true';

    console.log(`[CensorshipProcessor] Initialized (enabled: ${this.enabled})`);
    console.log(`[CensorshipProcessor] RunPod service URL: ${this.runpodServiceUrl}`);
  }

  /**
   * Initialize censorship for a stream
   * Creates session in RunPod service
   */
  async initializeCensorship(roomName, config = {}) {
    if (!this.enabled) {
      console.log('[CensorshipProcessor] Censorship disabled, skipping initialization');
      return { success: true, sessionId: null };
    }

    try {
      console.log(`[CensorshipProcessor] Initializing censorship for ${roomName}`);

      // Create session in RunPod service
      const response = await axios.post(`${this.runpodServiceUrl}/session/create`, {
        enable_text_detection: config.enableTextDetection !== false,
        enable_nsfw_detection: config.enableNSFWDetection !== false,
        enable_audio_profanity: config.enableAudioProfanity !== false,
        enable_object_tracking: config.enableObjectTracking !== false,
        text_confidence: config.textConfidence || 0.7,
        nsfw_confidence: config.nsfwConfidence || 0.85,
        audio_confidence: config.audioConfidence || 0.8,
        profanity_list: config.profanityList || [],
        frame_sample_rate: config.frameSampleRate || 1
      });

      const { session_id } = response.data;

      // Store session info
      this.activeSessions.set(roomName, {
        sessionId: session_id,
        config,
        createdAt: new Date(),
        frameCount: 0,
        detectionCount: 0,
        lastActivity: new Date()
      });

      console.log(`[CensorshipProcessor] Session created: ${session_id} for ${roomName}`);

      return {
        success: true,
        sessionId: session_id,
        config: response.data.config
      };

    } catch (error) {
      console.error('[CensorshipProcessor] Error initializing censorship:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process a video frame through censorship pipeline
   */
  async processFrame(roomName, frameBuffer) {
    const session = this.activeSessions.get(roomName);

    if (!session) {
      throw new Error(`No active censorship session for room: ${roomName}`);
    }

    try {
      // Create form data
      const formData = new FormData();
      formData.append('frame_data', frameBuffer, {
        filename: 'frame.jpg',
        contentType: 'image/jpeg'
      });

      // Send frame to RunPod service
      const response = await axios.post(
        `${this.runpodServiceUrl}/process/frame`,
        formData,
        {
          params: { session_id: session.sessionId },
          headers: formData.getHeaders(),
          responseType: 'json',
          maxContentLength: 100 * 1024 * 1024, // 100MB
          timeout: 5000 // 5 second timeout
        }
      );

      const result = response.data;

      // Update session stats
      session.frameCount++;
      session.lastActivity = new Date();

      if (result.detection_count > 0) {
        session.detectionCount += result.detection_count;
      }

      return {
        success: true,
        frameId: result.frame_id,
        detections: result.detections || [],
        detectionCount: result.detection_count || 0,
        hasBlur: result.has_blur || false,
        skipped: result.skipped || false,
        processingTimeMs: result.processing_time_ms || 0
      };

    } catch (error) {
      console.error('[CensorshipProcessor] Error processing frame:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process audio chunk for profanity detection
   */
  async processAudio(roomName, audioBuffer) {
    const session = this.activeSessions.get(roomName);

    if (!session) {
      throw new Error(`No active censorship session for room: ${roomName}`);
    }

    try {
      const formData = new FormData();
      formData.append('audio_data', audioBuffer, {
        filename: 'audio.wav',
        contentType: 'audio/wav'
      });

      const response = await axios.post(
        `${this.runpodServiceUrl}/process/audio`,
        formData,
        {
          params: { session_id: session.sessionId },
          headers: formData.getHeaders(),
          timeout: 10000 // 10 second timeout for audio
        }
      );

      const result = response.data;

      session.lastActivity = new Date();

      return {
        success: true,
        profanityDetected: result.profanity_detected || false,
        detections: result.detections || [],
        count: result.count || 0
      };

    } catch (error) {
      console.error('[CensorshipProcessor] Error processing audio:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * End censorship session
   */
  async endCensorship(roomName) {
    const session = this.activeSessions.get(roomName);

    if (!session) {
      console.log(`[CensorshipProcessor] No session to end for ${roomName}`);
      return { success: true };
    }

    try {
      console.log(`[CensorshipProcessor] Ending censorship session for ${roomName}`);

      // Delete session in RunPod service
      await axios.delete(
        `${this.runpodServiceUrl}/session/${session.sessionId}`
      );

      // Get session stats before removing
      const stats = {
        sessionId: session.sessionId,
        duration: Date.now() - session.createdAt.getTime(),
        frameCount: session.frameCount,
        detectionCount: session.detectionCount,
        config: session.config
      };

      // Remove from active sessions
      this.activeSessions.delete(roomName);

      console.log(`[CensorshipProcessor] Session ended: ${session.sessionId}`);

      return {
        success: true,
        stats
      };

    } catch (error) {
      console.error('[CensorshipProcessor] Error ending censorship:', error.message);

      // Remove from active sessions anyway
      this.activeSessions.delete(roomName);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get censorship statistics for a room
   */
  getCensorshipStats(roomName) {
    const session = this.activeSessions.get(roomName);

    if (!session) {
      return null;
    }

    return {
      sessionId: session.sessionId,
      frameCount: session.frameCount,
      detectionCount: session.detectionCount,
      detectionRate: session.frameCount > 0
        ? (session.detectionCount / session.frameCount * 100).toFixed(2) + '%'
        : '0%',
      duration: Date.now() - session.createdAt.getTime(),
      lastActivity: session.lastActivity,
      config: session.config
    };
  }

  /**
   * Get all active censorship sessions
   */
  getActiveSessions() {
    return Array.from(this.activeSessions.entries()).map(([roomName, session]) => ({
      roomName,
      ...this.getCensorshipStats(roomName)
    }));
  }

  /**
   * Check RunPod service health
   */
  async checkHealth() {
    try {
      const response = await axios.get(
        `${this.runpodServiceUrl}/health`,
        { timeout: 3000 }
      );

      return {
        available: true,
        status: response.data
      };

    } catch (error) {
      console.error('[CensorshipProcessor] Health check failed:', error.message);
      return {
        available: false,
        error: error.message
      };
    }
  }

  /**
   * Update censorship configuration for a room
   */
  async updateConfig(roomName, newConfig) {
    // End current session
    await this.endCensorship(roomName);

    // Create new session with updated config
    return await this.initializeCensorship(roomName, newConfig);
  }

  /**
   * Cleanup stale sessions (no activity for > 5 minutes)
   */
  async cleanupStaleSessions() {
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();

    for (const [roomName, session] of this.activeSessions.entries()) {
      const inactiveTime = now - session.lastActivity.getTime();

      if (inactiveTime > staleThreshold) {
        console.log(`[CensorshipProcessor] Cleaning up stale session: ${roomName}`);
        await this.endCensorship(roomName);
      }
    }
  }
}

// Singleton instance
const censorshipProcessor = new ContentCensorshipProcessor();

// Cleanup stale sessions every 5 minutes
setInterval(() => {
  censorshipProcessor.cleanupStaleSessions();
}, 5 * 60 * 1000);

export default censorshipProcessor;
