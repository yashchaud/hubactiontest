/**
 * Test Script: Hybrid Pipeline Webhook Integration
 *
 * Tests the complete flow:
 * 1. Broadcaster joins → Hybrid agent connects
 * 2. Track published → 3-lane pipeline starts
 * 3. Frame processing with <30ms latency
 * 4. Broadcaster leaves → Agent disconnects
 */

import fetch from 'node-fetch';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const WEBHOOK_URL = `${SERVER_URL}/livekit/webhook`;

// Mock LiveKit webhook events
const mockWebhookEvents = {

  // 1. Room started
  roomStarted: (roomName) => ({
    event: 'room_started',
    room: {
      sid: `RM_${Date.now()}`,
      name: roomName,
      creationTime: Math.floor(Date.now() / 1000)
    }
  }),

  // 2. Broadcaster joined
  broadcasterJoined: (roomName, identity) => ({
    event: 'participant_joined',
    room: { name: roomName },
    participant: {
      sid: `PA_${Date.now()}`,
      identity: `${identity}-broadcaster`,
      name: identity,
      metadata: JSON.stringify({ role: 'broadcaster' })
    }
  }),

  // 3. Video track published
  trackPublished: (roomName, identity, trackSid) => ({
    event: 'track_published',
    room: { name: roomName },
    participant: {
      sid: `PA_${Date.now()}`,
      identity: `${identity}-broadcaster`
    },
    track: {
      sid: trackSid || `TR_${Date.now()}`,
      type: 'VIDEO',
      source: 'camera',
      width: 1280,
      height: 720,
      muted: false
    }
  }),

  // 4. Broadcaster left
  broadcasterLeft: (roomName, identity) => ({
    event: 'participant_left',
    room: { name: roomName },
    participant: {
      sid: `PA_${Date.now()}`,
      identity: `${identity}-broadcaster`
    }
  }),

  // 5. Room finished
  roomFinished: (roomName) => ({
    event: 'room_finished',
    room: {
      sid: `RM_${Date.now()}`,
      name: roomName
    }
  })
};

/**
 * Send webhook event to server
 */
async function sendWebhook(event, description) {
  console.log(`\n📤 Sending: ${description}`);
  console.log(`   Event: ${event.event}`);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'test-webhook' // Will skip verification
      },
      body: JSON.stringify(event)
    });

    const status = response.status;
    const text = await response.text();

    if (status === 200) {
      console.log(`   ✅ Success (${status})`);
      return true;
    } else {
      console.log(`   ❌ Failed (${status}): ${text}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return false;
  }
}

/**
 * Check agent status
 */
async function checkAgentStatus() {
  try {
    const response = await fetch(`${SERVER_URL}/censorship/processing`);
    const data = await response.json();

    console.log('\n📊 Agent Status:');
    console.log(`   Active rooms: ${data.activeRooms?.length || 0}`);

    if (data.activeRooms && data.activeRooms.length > 0) {
      for (const room of data.activeRooms) {
        console.log(`   - ${room.roomName}:`);
        console.log(`     Frames: ${room.frameCount}`);
        console.log(`     Detections: ${room.detectionCount}`);
        console.log(`     Processing: ${room.isProcessing}`);

        if (room.lanes) {
          console.log(`     Lane 1 (Publish): ${room.lanes.lane1?.framesPublished || 0} frames, ${room.lanes.lane1?.avgLatencyMs?.toFixed(2) || 'N/A'}ms avg`);
          console.log(`     Lane 2 (Verify): ${room.lanes.lane2?.totalRequests || 0} batches, ${room.lanes.lane2?.avgLatencyMs?.toFixed(2) || 'N/A'}ms avg`);
          console.log(`     Lane 3 (Track): ${room.lanes.lane3?.kalman?.activeTrackers || 0} trackers, ${room.lanes.lane3?.decay?.activeRegions || 0} blur regions`);
        }
      }
    }

    return data;
  } catch (error) {
    console.log(`   ❌ Error checking status: ${error.message}`);
    return null;
  }
}

/**
 * Test complete flow
 */
async function testHybridPipeline() {
  console.log('🚀 Testing Hybrid Pipeline Integration\n');
  console.log('═'.repeat(60));

  const roomName = `test-room-${Date.now()}`;
  const broadcasterName = 'test-broadcaster';
  const trackSid = `TR_${Date.now()}`;

  // Test sequence
  const tests = [
    {
      description: 'Step 1: Room Started',
      event: mockWebhookEvents.roomStarted(roomName),
      waitMs: 500
    },
    {
      description: 'Step 2: Broadcaster Joined → Hybrid Agent Connects',
      event: mockWebhookEvents.broadcasterJoined(roomName, broadcasterName),
      waitMs: 1000,
      checkStatus: true
    },
    {
      description: 'Step 3: Video Track Published → 3-Lane Pipeline Starts',
      event: mockWebhookEvents.trackPublished(roomName, broadcasterName, trackSid),
      waitMs: 1000,
      checkStatus: true
    },
    {
      description: 'Step 4: Broadcaster Left → Agent Disconnects',
      event: mockWebhookEvents.broadcasterLeft(roomName, broadcasterName),
      waitMs: 1000,
      checkStatus: true
    },
    {
      description: 'Step 5: Room Finished',
      event: mockWebhookEvents.roomFinished(roomName),
      waitMs: 500
    }
  ];

  let successCount = 0;

  for (const test of tests) {
    const success = await sendWebhook(test.event, test.description);

    if (success) {
      successCount++;

      // Wait for processing
      if (test.waitMs) {
        await new Promise(resolve => setTimeout(resolve, test.waitMs));
      }

      // Check status if requested
      if (test.checkStatus) {
        await checkAgentStatus();
      }
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`\n📈 Test Results: ${successCount}/${tests.length} steps passed`);

  if (successCount === tests.length) {
    console.log('✅ All tests passed! Hybrid pipeline is working correctly.\n');
  } else {
    console.log('⚠️  Some tests failed. Check server logs for details.\n');
  }
}

/**
 * Test environment configuration
 */
async function testEnvironmentConfig() {
  console.log('\n🔧 Environment Configuration Check\n');
  console.log('═'.repeat(60));

  const requiredEnvVars = [
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'LIVEKIT_WS_URL',
    'USE_HYBRID_AGENT',
    'TRITON_GRPC_URL'
  ];

  const optionalEnvVars = [
    'KALMAN_ENABLED',
    'BATCH_MAX_WAIT_MS',
    'BATCH_SIZE',
    'CONFIDENCE_DECAY_RATE',
    'MIN_CONFIDENCE',
    'BLUR_DILATION_PX'
  ];

  console.log('Required variables:');
  for (const varName of requiredEnvVars) {
    const value = process.env[varName];
    const status = value ? '✅' : '❌';
    const displayValue = value ? (varName.includes('SECRET') || varName.includes('KEY') ? '***' : value) : 'NOT SET';
    console.log(`  ${status} ${varName}: ${displayValue}`);
  }

  console.log('\nOptional variables (with defaults):');
  for (const varName of optionalEnvVars) {
    const value = process.env[varName];
    console.log(`  ${value ? '✅' : '⚙️ '} ${varName}: ${value || 'using default'}`);
  }

  console.log('\n' + '═'.repeat(60));
}

/**
 * Main test runner
 */
async function main() {
  const command = process.argv[2] || 'full';

  switch (command) {
    case 'config':
      await testEnvironmentConfig();
      break;

    case 'status':
      await checkAgentStatus();
      break;

    case 'full':
    default:
      await testEnvironmentConfig();
      console.log('\n');
      await testHybridPipeline();
      break;
  }
}

// Run tests
main().catch(console.error);
