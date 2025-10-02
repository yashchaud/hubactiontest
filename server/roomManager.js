/**
 * Room Manager - Server-side room state management
 * Tracks active rooms, participants, streams, and metadata
 */

class RoomManager {
  constructor() {
    // In-memory storage (replace with Redis/Database for production)
    this.rooms = new Map();
    this.participants = new Map();
  }

  /**
   * Create or get a room
   */
  createRoom(roomName, metadata = {}) {
    if (this.rooms.has(roomName)) {
      return this.rooms.get(roomName);
    }

    const room = {
      name: roomName,
      createdAt: new Date(),
      broadcaster: null,
      viewers: new Set(),
      isLive: false,
      metadata: {
        ...metadata,
        participantCount: 0,
        viewerCount: 0
      },
      tracks: new Map(), // trackSid -> trackInfo
      recordings: [],
      analytics: {
        startTime: null,
        endTime: null,
        peakViewers: 0,
        totalViewers: 0
      }
    };

    this.rooms.set(roomName, room);
    console.log(`[RoomManager] Created room: ${roomName}`);
    return room;
  }

  /**
   * Get room by name
   */
  getRoom(roomName) {
    return this.rooms.get(roomName);
  }

  /**
   * Get all active rooms
   */
  getAllRooms() {
    return Array.from(this.rooms.values());
  }

  /**
   * Get all live rooms
   */
  getLiveRooms() {
    return Array.from(this.rooms.values()).filter(room => room.isLive);
  }

  /**
   * Set broadcaster for a room
   */
  setBroadcaster(roomName, participantIdentity, participantInfo = {}) {
    const room = this.getRoom(roomName);
    if (!room) {
      console.error(`[RoomManager] Room not found: ${roomName}`);
      return false;
    }

    room.broadcaster = {
      identity: participantIdentity,
      joinedAt: new Date(),
      ...participantInfo
    };

    room.isLive = true;
    room.analytics.startTime = new Date();

    console.log(`[RoomManager] Broadcaster set for ${roomName}: ${participantIdentity}`);
    return true;
  }

  /**
   * Add viewer to a room
   */
  addViewer(roomName, participantIdentity, participantInfo = {}) {
    const room = this.getRoom(roomName);
    if (!room) {
      console.error(`[RoomManager] Room not found: ${roomName}`);
      return false;
    }

    room.viewers.add(participantIdentity);
    room.metadata.viewerCount = room.viewers.size;
    room.metadata.participantCount = room.viewers.size + (room.broadcaster ? 1 : 0);

    // Update analytics
    room.analytics.totalViewers++;
    if (room.viewers.size > room.analytics.peakViewers) {
      room.analytics.peakViewers = room.viewers.size;
    }

    this.participants.set(participantIdentity, {
      roomName,
      role: 'viewer',
      joinedAt: new Date(),
      ...participantInfo
    });

    console.log(`[RoomManager] Viewer added to ${roomName}: ${participantIdentity} (Total: ${room.viewers.size})`);
    return true;
  }

  /**
   * Remove participant from a room
   */
  removeParticipant(roomName, participantIdentity) {
    const room = this.getRoom(roomName);
    if (!room) {
      return false;
    }

    // Check if broadcaster
    if (room.broadcaster && room.broadcaster.identity === participantIdentity) {
      room.broadcaster = null;
      room.isLive = false;
      room.analytics.endTime = new Date();
      console.log(`[RoomManager] Broadcaster left ${roomName}: ${participantIdentity}`);
    } else {
      // Remove viewer
      room.viewers.delete(participantIdentity);
      room.metadata.viewerCount = room.viewers.size;
      console.log(`[RoomManager] Viewer left ${roomName}: ${participantIdentity}`);
    }

    room.metadata.participantCount = room.viewers.size + (room.broadcaster ? 1 : 0);
    this.participants.delete(participantIdentity);

    // Clean up empty non-live rooms
    if (!room.isLive && room.viewers.size === 0) {
      this.deleteRoom(roomName);
    }

    return true;
  }

  /**
   * Add track to a room
   */
  addTrack(roomName, trackSid, trackInfo) {
    const room = this.getRoom(roomName);
    if (!room) {
      return false;
    }

    room.tracks.set(trackSid, {
      ...trackInfo,
      publishedAt: new Date()
    });

    console.log(`[RoomManager] Track added to ${roomName}: ${trackSid} (${trackInfo.source})`);
    return true;
  }

  /**
   * Remove track from a room
   */
  removeTrack(roomName, trackSid) {
    const room = this.getRoom(roomName);
    if (!room) {
      return false;
    }

    room.tracks.delete(trackSid);
    console.log(`[RoomManager] Track removed from ${roomName}: ${trackSid}`);
    return true;
  }

  /**
   * Get room status
   */
  getRoomStatus(roomName) {
    const room = this.getRoom(roomName);
    if (!room) {
      return null;
    }

    return {
      name: room.name,
      isLive: room.isLive,
      broadcaster: room.broadcaster?.identity || null,
      viewerCount: room.viewers.size,
      participantCount: room.metadata.participantCount,
      tracks: Array.from(room.tracks.values()),
      analytics: room.analytics,
      createdAt: room.createdAt
    };
  }

  /**
   * Add recording to a room
   */
  addRecording(roomName, recordingInfo) {
    const room = this.getRoom(roomName);
    if (!room) {
      return false;
    }

    room.recordings.push({
      ...recordingInfo,
      startedAt: new Date()
    });

    console.log(`[RoomManager] Recording started for ${roomName}`);
    return true;
  }

  /**
   * Delete a room
   */
  deleteRoom(roomName) {
    const room = this.rooms.get(roomName);
    if (!room) {
      return false;
    }

    // Clean up all participants
    room.viewers.forEach(viewerId => {
      this.participants.delete(viewerId);
    });

    this.rooms.delete(roomName);
    console.log(`[RoomManager] Deleted room: ${roomName}`);
    return true;
  }

  /**
   * Get participant info
   */
  getParticipant(participantIdentity) {
    return this.participants.get(participantIdentity);
  }

  /**
   * Get room analytics
   */
  getRoomAnalytics(roomName) {
    const room = this.getRoom(roomName);
    if (!room) {
      return null;
    }

    const duration = room.analytics.endTime
      ? room.analytics.endTime - room.analytics.startTime
      : room.analytics.startTime
        ? Date.now() - room.analytics.startTime
        : 0;

    return {
      ...room.analytics,
      duration: Math.floor(duration / 1000), // seconds
      averageViewers: room.analytics.totalViewers / Math.max(1, room.viewers.size),
      trackCount: room.tracks.size,
      recordingCount: room.recordings.length
    };
  }
}

// Singleton instance
const roomManager = new RoomManager();

export default roomManager;
