/**
 * LiveKit Webhooks Handler
 * Processes server-side events from LiveKit Cloud
 */

import { WebhookReceiver } from 'livekit-server-sdk';
import roomManager from './roomManager.js';
import { preProcessor } from './processors/preProcessor.js';
import { postProcessor } from './processors/postProcessor.js';
import processingBridge from './services/processingBridge.js';

const webhookReceiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

/**
 * Handle LiveKit webhook events
 */
export async function handleWebhook(req, res) {
  try {
    // Verify webhook signature
    const event = webhookReceiver.receive(
      JSON.stringify(req.body),
      req.headers.authorization
    );

    console.log(`[Webhook] Received event: ${event.event}`, {
      room: event.room?.name,
      participant: event.participant?.identity
    });

    // Route to appropriate handler
    switch (event.event) {
      case 'room_started':
        await handleRoomStarted(event);
        break;

      case 'room_finished':
        await handleRoomFinished(event);
        break;

      case 'participant_joined':
        await handleParticipantJoined(event);
        break;

      case 'participant_left':
        await handleParticipantLeft(event);
        break;

      case 'track_published':
        await handleTrackPublished(event);
        break;

      case 'track_unpublished':
        await handleTrackUnpublished(event);
        break;

      case 'recording_started':
        await handleRecordingStarted(event);
        break;

      case 'recording_finished':
        await handleRecordingFinished(event);
        break;

      case 'egress_started':
        await handleEgressStarted(event);
        break;

      case 'egress_ended':
        await handleEgressEnded(event);
        break;

      default:
        console.log(`[Webhook] Unhandled event type: ${event.event}`);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhook] Error processing webhook:', error);
    res.status(400).json({ error: 'Invalid webhook' });
  }
}

/**
 * Handle room_started event
 */
async function handleRoomStarted(event) {
  const roomName = event.room.name;

  console.log(`[Webhook] Room started: ${roomName}`);

  // Create room in manager
  roomManager.createRoom(roomName, {
    roomSid: event.room.sid,
    createdAt: new Date(event.room.creationTime * 1000)
  });
}

/**
 * Handle room_finished event
 */
async function handleRoomFinished(event) {
  const roomName = event.room.name;

  console.log(`[Webhook] Room finished: ${roomName}`);

  // Get room analytics before deletion
  const analytics = roomManager.getRoomAnalytics(roomName);

  // Trigger post-processing
  await postProcessor.processStreamEnd(roomName, analytics);

  // Clean up room (keep for analytics if needed)
  // roomManager.deleteRoom(roomName);
}

/**
 * Handle participant_joined event
 */
async function handleParticipantJoined(event) {
  const roomName = event.room.name;
  const participant = event.participant;
  const identity = participant.identity;

  console.log(`[Webhook] Participant joined ${roomName}: ${identity}`);

  // Determine role from identity suffix
  const isBroadcaster = identity.endsWith('-broadcaster');

  const participantInfo = {
    sid: participant.sid,
    name: participant.name,
    metadata: participant.metadata
  };

  if (isBroadcaster) {
    // Set as broadcaster
    roomManager.setBroadcaster(roomName, identity, participantInfo);

    // Trigger pre-processing for broadcaster
    await preProcessor.processBroadcasterJoin(roomName, identity, participantInfo);
  } else {
    // Add as viewer
    roomManager.addViewer(roomName, identity, participantInfo);
  }
}

/**
 * Handle participant_left event
 */
async function handleParticipantLeft(event) {
  const roomName = event.room.name;
  const participant = event.participant;
  const identity = participant.identity;

  console.log(`[Webhook] Participant left ${roomName}: ${identity}`);

  const isBroadcaster = identity.endsWith('-broadcaster');

  // Remove participant
  roomManager.removeParticipant(roomName, identity);

  if (isBroadcaster) {
    // Broadcaster left - trigger post-processing
    const analytics = roomManager.getRoomAnalytics(roomName);
    await postProcessor.processBroadcasterLeave(roomName, identity, analytics);
  }
}

/**
 * Handle track_published event
 */
async function handleTrackPublished(event) {
  const roomName = event.room.name;
  const participant = event.participant;
  const track = event.track;

  console.log(`[Webhook] Track published in ${roomName}:`, {
    participant: participant.identity,
    trackSid: track.sid,
    source: track.source,
    type: track.type
  });

  const trackInfo = {
    sid: track.sid,
    type: track.type,
    source: track.source,
    muted: track.muted,
    width: track.width,
    height: track.height,
    participant: participant.identity
  };

  roomManager.addTrack(roomName, track.sid, trackInfo);

  // Process track publication (e.g., start recording, analytics)
  await preProcessor.processTrackPublished(roomName, trackInfo);

  // Start server-side track processing for video tracks
  // Only process tracks from broadcaster (camera or screen share)
  if (track.type === 'VIDEO' && participant.identity.includes('broadcaster')) {
    console.log(`[Webhook] Starting server-side processing for broadcaster video track in ${roomName}`);

    try {
      const result = await processingBridge.startTrackProcessing(roomName, trackInfo);

      if (result.success) {
        console.log(`[Webhook] Track processing started successfully:`, {
          roomName,
          egressId: result.egressId
        });
      } else {
        console.warn(`[Webhook] Failed to start track processing:`, result.error);
      }
    } catch (error) {
      console.error(`[Webhook] Error starting track processing:`, error);
    }
  }
}

/**
 * Handle track_unpublished event
 */
async function handleTrackUnpublished(event) {
  const roomName = event.room.name;
  const track = event.track;

  console.log(`[Webhook] Track unpublished in ${roomName}: ${track.sid}`);

  roomManager.removeTrack(roomName, track.sid);
}

/**
 * Handle recording_started event
 */
async function handleRecordingStarted(event) {
  const roomName = event.room?.name;
  const egressInfo = event.egressInfo;

  console.log(`[Webhook] Recording started for ${roomName}:`, egressInfo.egressId);

  roomManager.addRecording(roomName, {
    egressId: egressInfo.egressId,
    status: egressInfo.status
  });
}

/**
 * Handle recording_finished event
 */
async function handleRecordingFinished(event) {
  const roomName = event.room?.name;
  const egressInfo = event.egressInfo;

  console.log(`[Webhook] Recording finished for ${roomName}:`, egressInfo.egressId);

  // Trigger post-processing for the recording
  await postProcessor.processRecording(roomName, {
    egressId: egressInfo.egressId,
    fileResults: egressInfo.fileResults,
    streamResults: egressInfo.streamResults
  });
}

/**
 * Handle egress_started event
 */
async function handleEgressStarted(event) {
  const egressInfo = event.egressInfo;
  console.log(`[Webhook] Egress started:`, egressInfo.egressId);
}

/**
 * Handle egress_ended event
 */
async function handleEgressEnded(event) {
  const egressInfo = event.egressInfo;
  console.log(`[Webhook] Egress ended:`, egressInfo.egressId);

  // Trigger any post-egress processing
  await postProcessor.processEgressEnd(egressInfo);
}

export default {
  handleWebhook
};
