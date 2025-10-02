import express from 'express';
import { AccessToken } from 'livekit-server-sdk';
import dotenv from 'dotenv';
import cors from 'cors';
import { handleWebhook } from './webhooks.js';
import streamManager from './streamManager.js';
import roomManager from './roomManager.js';
import censorshipRulesService from './services/censorshipRulesService.js';
import censorshipProcessor from './processors/contentCensorshipProcessor.js';
import processingBridge from './services/processingBridge.js';
import processorOrchestrator from './processors/processorOrchestrator.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

// ============================================================================
// WEBHOOK ENDPOINTS
// ============================================================================

/**
 * LiveKit webhook endpoint
 * Receives events from LiveKit Cloud for server-side processing
 */
app.post('/livekit/webhook', handleWebhook);

// ============================================================================
// STREAM MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * Start a new stream (with pre-processing)
 * POST /stream/start
 */
app.post('/stream/start', async (req, res) => {
  try {
    const { roomName, broadcasterName, options } = req.body;

    if (!roomName || !broadcasterName) {
      return res.status(400).json({
        error: 'roomName and broadcasterName are required'
      });
    }

    console.log(`[API] Starting stream: ${roomName} by ${broadcasterName}`);

    const result = await streamManager.startStream(roomName, broadcasterName, options || {});

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('[API] Error starting stream:', error);
    res.status(500).json({ error: 'Failed to start stream' });
  }
});

/**
 * End a stream (with post-processing)
 * POST /stream/end
 */
app.post('/stream/end', async (req, res) => {
  try {
    const { roomName } = req.body;

    if (!roomName) {
      return res.status(400).json({
        error: 'roomName is required'
      });
    }

    console.log(`[API] Ending stream: ${roomName}`);

    const result = await streamManager.endStream(roomName);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('[API] Error ending stream:', error);
    res.status(500).json({ error: 'Failed to end stream' });
  }
});

/**
 * Get stream status
 * GET /stream/status/:roomName
 */
app.get('/stream/status/:roomName', async (req, res) => {
  try {
    const { roomName } = req.params;

    const status = await streamManager.getStreamStatus(roomName);

    if (!status) {
      return res.status(404).json({ error: 'Stream not found' });
    }

    res.json(status);
  } catch (error) {
    console.error('[API] Error getting stream status:', error);
    res.status(500).json({ error: 'Failed to get stream status' });
  }
});

/**
 * List all active streams
 * GET /streams/active
 */
app.get('/streams/active', async (req, res) => {
  try {
    const streams = await streamManager.listActiveStreams();
    res.json({ streams, count: streams.length });
  } catch (error) {
    console.error('[API] Error listing streams:', error);
    res.status(500).json({ error: 'Failed to list streams' });
  }
});

/**
 * Start recording for a stream
 * POST /stream/recording/start
 */
app.post('/stream/recording/start', async (req, res) => {
  try {
    const { roomName, options } = req.body;

    if (!roomName) {
      return res.status(400).json({
        error: 'roomName is required'
      });
    }

    const result = await streamManager.startRecording(roomName, options || {});

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('[API] Error starting recording:', error);
    res.status(500).json({ error: 'Failed to start recording' });
  }
});

/**
 * Stop recording
 * POST /stream/recording/stop
 */
app.post('/stream/recording/stop', async (req, res) => {
  try {
    const { recordingId } = req.body;

    if (!recordingId) {
      return res.status(400).json({
        error: 'recordingId is required'
      });
    }

    const result = await streamManager.stopRecording(recordingId);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('[API] Error stopping recording:', error);
    res.status(500).json({ error: 'Failed to stop recording' });
  }
});

// ============================================================================
// ROOM MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * Get room analytics
 * GET /room/analytics/:roomName
 */
app.get('/room/analytics/:roomName', (req, res) => {
  try {
    const { roomName } = req.params;
    const analytics = roomManager.getRoomAnalytics(roomName);

    if (!analytics) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json(analytics);
  } catch (error) {
    console.error('[API] Error getting analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

/**
 * Get all active rooms
 * GET /rooms/active
 */
app.get('/rooms/active', (req, res) => {
  try {
    const rooms = roomManager.getLiveRooms();
    res.json({
      rooms: rooms.map(room => ({
        name: room.name,
        broadcaster: room.broadcaster?.identity,
        viewerCount: room.viewers.size,
        isLive: room.isLive,
        createdAt: room.createdAt
      })),
      count: rooms.length
    });
  } catch (error) {
    console.error('[API] Error listing rooms:', error);
    res.status(500).json({ error: 'Failed to list rooms' });
  }
});

// ============================================================================
// TOKEN GENERATION ENDPOINT (Enhanced)
// ============================================================================

/**
 * Generate access token for LiveKit
 * POST /token
 */
app.post('/token', async (req, res) => {
  try {
    const { roomName, participantName, role, metadata } = req.body;

    if (!roomName || !participantName) {
      return res.status(400).json({
        error: 'roomName and participantName are required'
      });
    }

    // Create access token with unique identity
    // Identity must be unique per room - append role to prevent conflicts
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: `${participantName}-${role || 'participant'}`,
      name: participantName,
      metadata: metadata ? JSON.stringify(metadata) : undefined
    });

    // Set permissions based on role
    const canPublish = role === 'broadcaster';

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: canPublish,
      canSubscribe: true,
      // Additional permissions
      canPublishData: true,
      canUpdateOwnMetadata: true
    });

    const token = await at.toJwt();

    console.log(`[API] Token generated for ${participantName} (${role}) in ${roomName}`);

    res.json({
      token,
      wsUrl: process.env.LIVEKIT_WS_URL,
      identity: `${participantName}-${role || 'participant'}`
    });
  } catch (error) {
    console.error('[API] Error generating token:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// ============================================================================
// HEALTH & INFO ENDPOINTS
// ============================================================================

/**
 * Health check endpoint
 * GET /health
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * Server info endpoint
 * GET /info
 */
app.get('/info', (req, res) => {
  const roomsCount = roomManager.getAllRooms().length;
  const liveRoomsCount = roomManager.getLiveRooms().length;

  res.json({
    server: 'LiveKit Webinar Server',
    version: '2.0.0',
    features: [
      'Server-side stream management',
      'Pre/post processing pipelines',
      'Webhook event handling',
      'Room state management',
      'Recording management',
      'Analytics tracking'
    ],
    stats: {
      totalRooms: roomsCount,
      liveRooms: liveRoomsCount,
      uptime: process.uptime()
    },
    livekitConfigured: !!LIVEKIT_API_KEY,
    websocketUrl: process.env.LIVEKIT_WS_URL || 'NOT SET'
  });
});

// ============================================================================
// CENSORSHIP MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * Get censorship rules
 * GET /censorship/rules
 */
app.get('/censorship/rules', (req, res) => {
  try {
    const { roomName } = req.query;

    const rules = roomName
      ? censorshipRulesService.getRoomRules(roomName)
      : censorshipRulesService.getRules();

    res.json(rules);
  } catch (error) {
    console.error('[API] Error getting censorship rules:', error);
    res.status(500).json({ error: 'Failed to get censorship rules' });
  }
});

/**
 * Update censorship rules
 * POST /censorship/rules
 */
app.post('/censorship/rules', async (req, res) => {
  try {
    const { roomName, rules } = req.body;

    if (!rules) {
      return res.status(400).json({ error: 'rules are required' });
    }

    const result = roomName
      ? await censorshipRulesService.updateRoomRules(roomName, rules)
      : await censorshipRulesService.updateGlobalRules(rules);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ success: true, message: 'Rules updated successfully' });
  } catch (error) {
    console.error('[API] Error updating censorship rules:', error);
    res.status(500).json({ error: 'Failed to update censorship rules' });
  }
});

/**
 * Get censorship statistics
 * GET /censorship/stats/:roomName
 */
app.get('/censorship/stats/:roomName', (req, res) => {
  try {
    const { roomName } = req.params;

    const stats = censorshipProcessor.getCensorshipStats(roomName);

    if (!stats) {
      return res.status(404).json({ error: 'No censorship stats found for room' });
    }

    res.json(stats);
  } catch (error) {
    console.error('[API] Error getting censorship stats:', error);
    res.status(500).json({ error: 'Failed to get censorship stats' });
  }
});

/**
 * Get all active censorship sessions
 * GET /censorship/sessions
 */
app.get('/censorship/sessions', (req, res) => {
  try {
    const sessions = censorshipProcessor.getActiveSessions();
    res.json({
      sessions,
      count: sessions.length
    });
  } catch (error) {
    console.error('[API] Error listing censorship sessions:', error);
    res.status(500).json({ error: 'Failed to list censorship sessions' });
  }
});

/**
 * Add word to profanity list
 * POST /censorship/profanity/add
 */
app.post('/censorship/profanity/add', async (req, res) => {
  try {
    const { word, type } = req.body;

    if (!word) {
      return res.status(400).json({ error: 'word is required' });
    }

    const result = await censorshipRulesService.addProfanityWord(word, type || 'text');

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ success: true, message: 'Profanity word added' });
  } catch (error) {
    console.error('[API] Error adding profanity word:', error);
    res.status(500).json({ error: 'Failed to add profanity word' });
  }
});

/**
 * Remove word from profanity list
 * POST /censorship/profanity/remove
 */
app.post('/censorship/profanity/remove', async (req, res) => {
  try {
    const { word, type } = req.body;

    if (!word) {
      return res.status(400).json({ error: 'word is required' });
    }

    const result = await censorshipRulesService.removeProfanityWord(word, type || 'text');

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ success: true, message: 'Profanity word removed' });
  } catch (error) {
    console.error('[API] Error removing profanity word:', error);
    res.status(500).json({ error: 'Failed to remove profanity word' });
  }
});

/**
 * Get processing status for a room
 * GET /censorship/processing/:roomName
 */
app.get('/censorship/processing/:roomName', (req, res) => {
  try {
    const { roomName } = req.params;

    const status = processingBridge.getStatus(roomName);

    if (!status) {
      return res.status(404).json({ error: 'No active processing for room' });
    }

    res.json(status);
  } catch (error) {
    console.error('[API] Error getting processing status:', error);
    res.status(500).json({ error: 'Failed to get processing status' });
  }
});

/**
 * Get all active processing streams
 * GET /censorship/processing
 */
app.get('/censorship/processing', (req, res) => {
  try {
    const streams = processingBridge.getActiveStreams();
    res.json({
      streams,
      count: streams.length
    });
  } catch (error) {
    console.error('[API] Error listing processing streams:', error);
    res.status(500).json({ error: 'Failed to list processing streams' });
  }
});

/**
 * Check RunPod service health
 * GET /censorship/health
 */
app.get('/censorship/health', async (req, res) => {
  try {
    const health = await censorshipProcessor.checkHealth();
    res.json(health);
  } catch (error) {
    console.error('[API] Error checking censorship health:', error);
    res.status(500).json({ error: 'Failed to check censorship health' });
  }
});

/**
 * Get processor orchestrator stats
 * GET /processors/stats
 */
app.get('/processors/stats', (req, res) => {
  try {
    const stats = processorOrchestrator.getStats();
    res.json(stats);
  } catch (error) {
    console.error('[API] Error getting processor stats:', error);
    res.status(500).json({ error: 'Failed to get processor stats' });
  }
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, async () => {
  console.log('\n🚀 LiveKit Webinar Server Started\n');
  console.log(`Server running on port ${PORT}`);
  console.log(`\n📡 Stream Endpoints:`);
  console.log(`  - Token generation: POST http://localhost:${PORT}/token`);
  console.log(`  - Webhook receiver: POST http://localhost:${PORT}/livekit/webhook`);
  console.log(`  - Start stream:     POST http://localhost:${PORT}/stream/start`);
  console.log(`  - End stream:       POST http://localhost:${PORT}/stream/end`);
  console.log(`  - Stream status:    GET  http://localhost:${PORT}/stream/status/:roomName`);
  console.log(`  - Active streams:   GET  http://localhost:${PORT}/streams/active`);
  console.log(`\n🔒 Censorship Endpoints:`);
  console.log(`  - Get rules:        GET  http://localhost:${PORT}/censorship/rules`);
  console.log(`  - Update rules:     POST http://localhost:${PORT}/censorship/rules`);
  console.log(`  - Get stats:        GET  http://localhost:${PORT}/censorship/stats/:roomName`);
  console.log(`  - Active sessions:  GET  http://localhost:${PORT}/censorship/sessions`);
  console.log(`  - Add profanity:    POST http://localhost:${PORT}/censorship/profanity/add`);
  console.log(`  - Remove profanity: POST http://localhost:${PORT}/censorship/profanity/remove`);
  console.log(`  - Processing:       GET  http://localhost:${PORT}/censorship/processing/:roomName`);
  console.log(`  - Health check:     GET  http://localhost:${PORT}/censorship/health`);
  console.log(`\n📊 Monitoring Endpoints:`);
  console.log(`  - Room analytics:   GET  http://localhost:${PORT}/room/analytics/:roomName`);
  console.log(`  - Processor stats:  GET  http://localhost:${PORT}/processors/stats`);
  console.log(`  - Server info:      GET  http://localhost:${PORT}/info`);
  console.log(`  - Health check:     GET  http://localhost:${PORT}/health`);
  console.log(`\n⚙️  Configuration:`);
  console.log(`  - LiveKit configured: ${LIVEKIT_API_KEY ? 'Yes ✅' : 'No ❌'}`);
  console.log(`  - WebSocket URL: ${process.env.LIVEKIT_WS_URL || 'NOT SET ❌'}`);
  console.log(`  - Censorship enabled: ${process.env.ENABLE_CENSORSHIP === 'true' ? 'Yes ✅' : 'No ❌'}`);
  console.log(`  - RunPod service URL: ${process.env.RUNPOD_SERVICE_URL || 'NOT SET ❌'}`);
  console.log(`\n✨ Features enabled:`);
  console.log(`  - Server-side stream management ✅`);
  console.log(`  - Pre/post processing pipelines ✅`);
  console.log(`  - Processor orchestration ✅`);
  console.log(`  - Real-time content censorship ${process.env.ENABLE_CENSORSHIP === 'true' ? '✅' : '❌'}`);
  console.log(`  - Webhook event handling ✅`);
  console.log(`  - Room state tracking ✅`);
  console.log(`  - Analytics & monitoring ✅`);

  // Check censorship service health
  if (process.env.ENABLE_CENSORSHIP === 'true') {
    console.log(`\n🔍 Checking RunPod censorship service...`);
    try {
      const health = await censorshipProcessor.checkHealth();
      if (health.available) {
        console.log(`  - RunPod service: ONLINE ✅`);
      } else {
        console.log(`  - RunPod service: OFFLINE ❌ (${health.error})`);
      }
    } catch (error) {
      console.log(`  - RunPod service: ERROR ❌ (${error.message})`);
    }
  }

  console.log('\n');
});
