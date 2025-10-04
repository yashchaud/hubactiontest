/**
 * Frame Extractor Service
 * Now uses CensorshipAgent (server-side participant) for low-latency frame extraction
 * Replaced file-based egress with real-time WebRTC track subscription
 */

import { EventEmitter } from 'events';
import censorshipAgent from './censorshipAgent.js';

class FrameExtractor extends EventEmitter {
  constructor() {
    super();
    this.activeExtractors = new Map(); // roomName -> extractor info
    console.log('[FrameExtractor] Initialized (Agent-based extraction)');

    // Forward events from censorship agent
    censorshipAgent.on('detection', (data) => {
      this.emit('detection', data);
    });

    censorshipAgent.on('processing:started', (data) => {
      this.emit('extraction:started', data);
    });
  }

  /**
   * Start extracting frames using server-side participant agent
   * @param {string} roomName - Room name
   * @param {string} trackSid - Track SID (not used with agent, kept for compatibility)
   * @param {string} censorshipSessionId - RunPod session ID
   * @param {string} wsUrl - LiveKit WebSocket URL
   * @param {string} agentToken - Access token for agent participant
   */
  async startExtraction(roomName, trackSid, censorshipSessionId, wsUrl, agentToken) {
    if (this.activeExtractors.has(roomName)) {
      console.log(`[FrameExtractor] Already extracting for ${roomName}`);
      return this.activeExtractors.get(roomName);
    }

    try {
      console.log(`[FrameExtractor] Starting agent-based extraction for ${roomName}`);
      console.log(`  - Method: Server-side participant (CensorshipAgent)`);
      console.log(`  - Expected latency: 200-500ms`);

      // Connect agent to room
      const result = await censorshipAgent.connect(
        roomName,
        wsUrl,
        agentToken,
        censorshipSessionId
      );

      // Store extractor info
      const extractor = {
        roomName,
        trackSid,
        censorshipSessionId,
        method: 'agent',
        agentIdentity: result.agentIdentity,
        frameCount: 0,
        detectionCount: 0,
        startedAt: new Date()
      };

      this.activeExtractors.set(roomName, extractor);

      console.log(`[FrameExtractor] Agent connected to ${roomName}`);
      console.log(`  - Agent identity: ${result.agentIdentity}`);

      return {
        success: true,
        method: 'agent',
        agentIdentity: result.agentIdentity
      };

    } catch (error) {
      console.error(`[FrameExtractor] Error starting extraction for ${roomName}:`, error);
      throw error;
    }
  }

  /**
   * Get frame extraction statistics
   */
  getExtractionStats(roomName) {
    const extractor = this.activeExtractors.get(roomName);
    if (!extractor) return null;

    return {
      frameCount: extractor.frameCount,
      detectionCount: extractor.detectionCount,
      detectionRate: extractor.frameCount > 0
        ? ((extractor.detectionCount / extractor.frameCount) * 100).toFixed(2) + '%'
        : '0%',
      uptime: Date.now() - extractor.startedAt.getTime()
    };
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

      // Disconnect agent from room
      const result = await censorshipAgent.disconnect(roomName);

      this.activeExtractors.delete(roomName);

      this.emit('extraction:stopped', { roomName, stats: result.stats });

      return result;

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
