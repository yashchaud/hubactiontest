/**
 * Stream Manager - Controls stream lifecycle and processing
 * Manages pre/post processing pipelines for streams
 */

import { RoomServiceClient, EgressClient } from 'livekit-server-sdk';
import roomManager from './roomManager.js';
import { preProcessor } from './processors/preProcessor.js';
import { postProcessor } from './processors/postProcessor.js';
import processorOrchestrator from './processors/processorOrchestrator.js';
import censorshipProcessor from './processors/contentCensorshipProcessor.js';
import processingBridge from './services/processingBridge.js';
import censorshipRulesService from './services/censorshipRulesService.js';

const LIVEKIT_HOST = process.env.LIVEKIT_WS_URL?.replace('wss://', 'https://') || 'https://localhost';

const roomService = new RoomServiceClient(
  LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

const egressClient = new EgressClient(
  LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

class StreamManager {
  constructor() {
    this.activeStreams = new Map();

    // Register processors with orchestrator
    processorOrchestrator.register('pre', preProcessor, {
      priority: 10,
      runInParallel: false
    });

    processorOrchestrator.register('post', postProcessor, {
      priority: 90,
      runInParallel: false
    });

    processorOrchestrator.register('censorship', censorshipProcessor, {
      priority: 50,
      runInParallel: true,
      condition: (context) => context.enableCensorship === true
    });
  }

  /**
   * Start a new stream
   * @param {string} roomName - Room name
   * @param {string} broadcasterName - Broadcaster identity
   * @param {object} options - Stream options
   */
  async startStream(roomName, broadcasterName, options = {}) {
    try {
      console.log(`[StreamManager] Starting stream for room: ${roomName}`);

      // Check if censorship is enabled
      const enableCensorship = options.enableCensorship !== false;

      // Start censorship processing if enabled
      let censorshipInfo = null;
      if (enableCensorship) {
        const censorshipConfig = censorshipRulesService.getCensorshipConfig(roomName);
        const processingResult = await processingBridge.startProcessing(
          roomName,
          censorshipConfig
        );

        if (processingResult.success) {
          censorshipInfo = processingResult;
          console.log(`[StreamManager] Censorship enabled for ${roomName}`);
        } else {
          console.warn(`[StreamManager] Censorship failed to start: ${processingResult.error}`);
        }
      }

      // Run pre-processing pipeline through orchestrator
      const context = { enableCensorship, roomName, broadcasterName };
      const preProcessResult = await processorOrchestrator.executeSelected(
        ['pre'],
        'prepareStream',
        [roomName, broadcasterName, options],
        context
      );

      if (!preProcessResult.success) {
        throw new Error('Pre-processing failed');
      }

      // Create room in LiveKit with enhanced metadata
      const room = await this.ensureRoomExists(roomName, {
        emptyTimeout: 300, // 5 minutes timeout when empty
        maxParticipants: options.maxParticipants || 10000,
        metadata: JSON.stringify({
          broadcaster: broadcasterName,
          startedAt: new Date().toISOString(),
          censorshipEnabled: enableCensorship,
          rtmpUrl: censorshipInfo?.rtmpUrl,
          processingConfig: preProcessResult.results[0]?.result?.config
        })
      });

      // Create room in room manager
      roomManager.createRoom(roomName, {
        roomSid: room.sid,
        broadcaster: broadcasterName,
        options,
        censorshipEnabled: enableCensorship,
        censorshipInfo,
        processingConfig: preProcessResult.results[0]?.result?.config
      });

      // Start recording if enabled
      if (options.enableRecording) {
        await this.startRecording(roomName);
      }

      // Track active stream
      this.activeStreams.set(roomName, {
        roomName,
        broadcaster: broadcasterName,
        startedAt: new Date(),
        options,
        recordingId: null,
        censorshipEnabled: enableCensorship,
        censorshipInfo
      });

      console.log(`[StreamManager] Stream started successfully: ${roomName}`);

      return {
        success: true,
        roomName,
        roomSid: room.sid,
        censorshipEnabled: enableCensorship,
        censorshipInfo: censorshipInfo ? {
          rtmpUrl: censorshipInfo.rtmpUrl,
          streamKey: censorshipInfo.streamKey
        } : null,
        processingConfig: preProcessResult.results[0]?.result?.config
      };
    } catch (error) {
      console.error(`[StreamManager] Error starting stream:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * End a stream
   * @param {string} roomName - Room name
   */
  async endStream(roomName) {
    try {
      console.log(`[StreamManager] Ending stream for room: ${roomName}`);

      const streamInfo = this.activeStreams.get(roomName);

      // Stop censorship processing if enabled
      if (streamInfo?.censorshipEnabled) {
        await processingBridge.stopProcessing(roomName);
      }

      // Get final analytics
      const analytics = roomManager.getRoomAnalytics(roomName);

      // Get censorship stats
      const censorshipStats = censorshipProcessor.getCensorshipStats(roomName);

      // Run post-processing pipeline through orchestrator
      await processorOrchestrator.executeSelected(
        ['post'],
        'processStreamEnd',
        [roomName, { ...analytics, streamInfo, censorshipStats }],
        { roomName }
      );

      // Stop any active recordings
      if (streamInfo?.recordingId) {
        await this.stopRecording(streamInfo.recordingId);
      }

      // Remove participants and close room
      await roomService.deleteRoom(roomName);

      // Clean up
      this.activeStreams.delete(roomName);
      roomManager.deleteRoom(roomName);

      console.log(`[StreamManager] Stream ended successfully: ${roomName}`);

      return {
        success: true,
        analytics,
        censorshipStats
      };
    } catch (error) {
      console.error(`[StreamManager] Error ending stream:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get stream status
   * @param {string} roomName - Room name
   */
  async getStreamStatus(roomName) {
    try {
      // Get from LiveKit
      const rooms = await roomService.listRooms([roomName]);
      const livekitRoom = rooms.find(r => r.name === roomName);

      // Get from room manager
      const roomStatus = roomManager.getRoomStatus(roomName);

      // Get active stream info
      const streamInfo = this.activeStreams.get(roomName);

      return {
        exists: !!livekitRoom,
        isLive: roomStatus?.isLive || false,
        ...roomStatus,
        livekit: livekitRoom ? {
          sid: livekitRoom.sid,
          numParticipants: livekitRoom.numParticipants,
          creationTime: livekitRoom.creationTime
        } : null,
        streamInfo
      };
    } catch (error) {
      console.error(`[StreamManager] Error getting stream status:`, error);
      return null;
    }
  }

  /**
   * List all active streams
   */
  async listActiveStreams() {
    return Array.from(this.activeStreams.values());
  }

  /**
   * Start recording for a room
   * @param {string} roomName - Room name
   */
  async startRecording(roomName, options = {}) {
    try {
      console.log(`[StreamManager] Starting recording for room: ${roomName}`);

      const fileOutput = {
        fileType: options.fileType || 'MP4',
        filepath: options.filepath || `recordings/${roomName}/${Date.now()}.mp4`,
        ...options.fileOptions
      };

      const egressInfo = await egressClient.startRoomCompositeEgress(roomName, {
        file: fileOutput,
        layout: options.layout || 'speaker',
        audioOnly: options.audioOnly || false,
        videoOnly: options.videoOnly || false
      });

      const streamInfo = this.activeStreams.get(roomName);
      if (streamInfo) {
        streamInfo.recordingId = egressInfo.egressId;
      }

      roomManager.addRecording(roomName, {
        egressId: egressInfo.egressId,
        filepath: fileOutput.filepath,
        status: egressInfo.status
      });

      console.log(`[StreamManager] Recording started: ${egressInfo.egressId}`);

      return {
        success: true,
        recordingId: egressInfo.egressId,
        filepath: fileOutput.filepath
      };
    } catch (error) {
      console.error(`[StreamManager] Error starting recording:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Stop recording
   * @param {string} recordingId - Egress ID
   */
  async stopRecording(recordingId) {
    try {
      console.log(`[StreamManager] Stopping recording: ${recordingId}`);
      await egressClient.stopEgress(recordingId);
      return { success: true };
    } catch (error) {
      console.error(`[StreamManager] Error stopping recording:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Ensure room exists in LiveKit
   */
  async ensureRoomExists(roomName, options = {}) {
    try {
      const rooms = await roomService.listRooms([roomName]);
      if (rooms.length > 0) {
        return rooms[0];
      }

      // Create room
      const room = await roomService.createRoom({
        name: roomName,
        ...options
      });

      return room;
    } catch (error) {
      console.error(`[StreamManager] Error ensuring room exists:`, error);
      throw error;
    }
  }

  /**
   * Update stream metadata
   */
  async updateStreamMetadata(roomName, metadata) {
    try {
      await roomService.updateRoomMetadata(roomName, JSON.stringify(metadata));
      return { success: true };
    } catch (error) {
      console.error(`[StreamManager] Error updating metadata:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Remove participant from stream
   */
  async removeParticipant(roomName, participantIdentity) {
    try {
      await roomService.removeParticipant(roomName, participantIdentity);
      return { success: true };
    } catch (error) {
      console.error(`[StreamManager] Error removing participant:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Singleton instance
const streamManager = new StreamManager();

export default streamManager;
