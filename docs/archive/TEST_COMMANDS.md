# Testing Commands - Copy & Paste Guide

## Prerequisites
- RunPod service running at: `http://your-runpod-url:8000` (replace with actual URL)
- Server running locally: `http://localhost:3001`
- Client running locally: `http://localhost:3000`

---

## Test 1: RunPod Service Health Check

### 1.1 Check if RunPod is running
```bash
curl http://your-runpod-url:8000/health
```

**Expected Response**:
```json
{
  "status": "healthy",
  "uptime": 123.45,
  "gpu_available": true
}
```

---

## Test 2: RunPod Session Creation

### 2.1 Create a censorship session
```bash
curl -X POST http://your-runpod-url:8000/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "nsfw_detection": true,
      "text_detection": true,
      "audio_profanity": false,
      "blur_strength": 25
    }
  }'
```

**Expected Response**:
```json
{
  "session_id": "abc123-def456-ghi789",
  "status": "active",
  "config": {
    "nsfw_detection": true,
    "text_detection": true,
    "audio_profanity": false,
    "blur_strength": 25
  }
}
```

**Save the `session_id` for next tests!**

---

## Test 3: RunPod Frame Processing (with sample image)

### 3.1 Download a test image
```bash
# Create a test directory
mkdir -p test-data
cd test-data

# Download a sample image (safe test image)
curl -o test-image.jpg https://via.placeholder.com/640x480/FF5733/FFFFFF?text=Test+Image

# Or use any local image you have
# cp /path/to/your/image.jpg test-image.jpg
```

### 3.2 Process the frame
```bash
# Replace SESSION_ID with the one from Test 2.1
SESSION_ID="abc123-def456-ghi789"

curl -X POST http://your-runpod-url:8000/censorship/process-frame \
  -F "frame=@test-image.jpg" \
  -F "session_id=$SESSION_ID"
```

**Expected Response**:
```json
{
  "frame_id": "frame_001",
  "detections": [],
  "blurred_regions": [],
  "processing_time_ms": 123.45,
  "session_id": "abc123-def456-ghi789"
}
```

**If there are detections**:
```json
{
  "frame_id": "frame_001",
  "detections": [
    {
      "type": "nsfw",
      "confidence": 0.85,
      "bbox": [100, 200, 300, 400],
      "label": "EXPOSED_BREAST_F"
    }
  ],
  "blurred_regions": [[100, 200, 300, 400]],
  "processing_time_ms": 156.78,
  "session_id": "abc123-def456-ghi789"
}
```

---

## Test 4: Server - Token Generation

### 4.1 Generate broadcaster token
```bash
curl -X POST http://localhost:3001/token \
  -H "Content-Type: application/json" \
  -d '{
    "roomName": "test-room-001",
    "participantName": "Broadcaster1",
    "role": "broadcaster"
  }'
```

**Expected Response**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "wsUrl": "wss://your-project.livekit.cloud",
  "identity": "Broadcaster1-broadcaster"
}
```

### 4.2 Generate viewer token
```bash
curl -X POST http://localhost:3001/token \
  -H "Content-Type: application/json" \
  -d '{
    "roomName": "test-room-001",
    "participantName": "Viewer1",
    "role": "viewer"
  }'
```

**Expected Response**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "wsUrl": "wss://your-project.livekit.cloud",
  "identity": "Viewer1-viewer"
}
```

---

## Test 5: Server - Stream Start

### 5.1 Start a stream with censorship
```bash
# Replace with your actual RunPod URL
export RUNPOD_URL="http://your-runpod-url:8000"

curl -X POST http://localhost:3001/stream/start \
  -H "Content-Type: application/json" \
  -d '{
    "roomName": "test-room-001",
    "broadcasterIdentity": "Broadcaster1-broadcaster",
    "censorshipConfig": {
      "nsfw_detection": true,
      "text_detection": true,
      "audio_profanity": true,
      "blur_strength": 25
    }
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "roomName": "test-room-001",
  "censorshipSessionId": "xyz789-abc123",
  "message": "Stream started successfully"
}
```

**Check Server Logs** (in server terminal):
```
[StreamManager] Starting stream: test-room-001
[ProcessingBridge] Starting processing for test-room-001
[ProcessingBridge] Processing started for test-room-001
  - Censorship Session: xyz789-abc123
```

---

## Test 6: Server - Get Stream Status

### 6.1 Check stream status
```bash
curl http://localhost:3001/stream/status/test-room-001
```

**Expected Response**:
```json
{
  "roomName": "test-room-001",
  "isActive": true,
  "censorshipSessionId": "xyz789-abc123",
  "startedAt": "2025-10-02T10:30:00.000Z",
  "participants": [],
  "tracks": []
}
```

---

## Test 7: Complete End-to-End Flow

### 7.1 Start the server (in one terminal)
```bash
cd server
npm start
```

**Expected Output**:
```
Server running on port 3001
[ProcessingBridge] Initialized
[FrameExtractor] Initialized
  - Processing FPS: 5
  - RunPod URL: http://your-runpod-url:8000
```

### 7.2 Start the client (in another terminal)
```bash
cd client
npm run dev
```

**Expected Output**:
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

### 7.3 Open browser and test

**Step 1: Open broadcaster**
1. Navigate to: `http://localhost:3000`
2. Select "Broadcaster" mode
3. Enter room name: `test-room-001`
4. Enter your name: `John`
5. Click "Join Room"
6. Allow camera/microphone permissions
7. You should see your video preview

**Expected Server Logs**:
```
[Webhook] Room created: test-room-001
[Webhook] Participant joined test-room-001: John-broadcaster
[Webhook] Track published in test-room-001:
  participant: John-broadcaster
  trackSid: TR_xxxxx
  source: camera
  type: VIDEO
[Webhook] Starting server-side processing for broadcaster video track in test-room-001
[ProcessingBridge] Starting track processing for test-room-001
  - Track SID: TR_xxxxx
  - Track type: VIDEO
  - Track source: camera
[FrameExtractor] Starting frame extraction for test-room-001
[FrameExtractor] Started egress: egr_xxxxx
[ProcessingBridge] Track processing started for test-room-001
  - Egress ID: egr_xxxxx
```

**Step 2: Open viewer (in another browser tab/window)**
1. Navigate to: `http://localhost:3000`
2. Select "Viewer" mode
3. Enter same room name: `test-room-001`
4. Enter viewer name: `Alice`
5. Click "Join Room"
6. You should see the broadcaster's video (raw stream)

**Expected Server Logs**:
```
[Webhook] Participant joined test-room-001: Alice-viewer
```

---

## Test 8: Check Active Streams

### 8.1 List all active streams
```bash
curl http://localhost:3001/streams/active
```

**Expected Response**:
```json
[
  {
    "roomName": "test-room-001",
    "isActive": true,
    "censorshipSessionId": "xyz789-abc123",
    "startedAt": "2025-10-02T10:30:00.000Z",
    "participants": [
      "John-broadcaster",
      "Alice-viewer"
    ],
    "trackCount": 2
  }
]
```

### 8.2 Get room analytics
```bash
curl http://localhost:3001/room/analytics/test-room-001
```

**Expected Response**:
```json
{
  "roomName": "test-room-001",
  "duration": 120000,
  "viewerCount": 1,
  "peakViewerCount": 1,
  "trackPublications": 2,
  "detectionCount": 0
}
```

---

## Test 9: Check Processing Bridge Status

### 9.1 Check if processing is active (via server logs)
Look for these log messages:

**When stream starts**:
```
[ProcessingBridge] Processing started for test-room-001
  - Censorship Session: xyz789-abc123
```

**When video track is published**:
```
[ProcessingBridge] Starting track processing for test-room-001
  - Track SID: TR_xxxxx
[FrameExtractor] Starting frame extraction for test-room-001
[FrameExtractor] Started egress: egr_xxxxx
```

**Frame extraction loop** (every 200ms = 5 FPS):
```
[FrameExtractor] test-room-001 - Extracted frame 1
[FrameExtractor] test-room-001 - Extracted frame 2
[FrameExtractor] test-room-001 - Extracted frame 3
```

---

## Test 10: Client-Side Frame Processing (Legacy)

### 10.1 Check browser console (broadcaster side)
Open browser DevTools (F12) on the broadcaster window.

**Expected Console Logs**:
```
[CensorshipProcessor] Initialized
[CensorshipProcessor] Processing frame...
[CensorshipProcessor] Sending frame to server...
[CensorshipProcessor] Detection result: {detections: [], frameId: "..."}
```

**This is the existing 1 FPS client-side processing.**

---

## Test 11: End Stream

### 11.1 Stop the stream
```bash
curl -X POST http://localhost:3001/stream/end \
  -H "Content-Type: application/json" \
  -d '{
    "roomName": "test-room-001"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "roomName": "test-room-001",
  "stats": {
    "duration": 180000,
    "frameCount": 15,
    "detectionCount": 0,
    "detectionRate": "0%"
  }
}
```

**Expected Server Logs**:
```
[ProcessingBridge] Stopping processing for test-room-001
[FrameExtractor] Stopping extraction for test-room-001
[FrameExtractor] Stopped egress: egr_xxxxx
[ProcessingBridge] Processing stopped: {
  roomName: 'test-room-001',
  duration: 180000,
  frameCount: 15,
  detectionCount: 0,
  detectionRate: '0%',
  egressId: 'egr_xxxxx'
}
```

---

## Test 12: Verify NumPy Fix (RunPod Logs)

### 12.1 Check RunPod container logs
```bash
# If running locally:
docker logs <container-id>

# If on RunPod:
# Check logs in RunPod dashboard
```

**Expected Output** (should NOT have NumPy errors):
```
INFO:     Started server process [20]
INFO:     Waiting for application startup.
2025-10-02 10:11:39,666 - main - INFO - Initializing ML models...
2025-10-02 10:11:42,268 - processors.text_detector - INFO - Loading Keras-OCR pipeline...
2025-10-02 10:11:49,967 - processors.text_detector - INFO - Keras-OCR pipeline loaded successfully
2025-10-02 10:11:49,967 - processors.text_detector - INFO - TextDetector initialized
2025-10-02 10:11:50,058 - processors.nsfw_detector - INFO - NudeNet detector loaded successfully
2025-10-02 10:11:50,065 - main - INFO - All ML models loaded successfully
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

**Should NOT see**:
```
❌ AttributeError: _ARRAY_API not found
❌ A module that was compiled using NumPy 1.x cannot be run in NumPy 2.x
```

---

## Quick Reference: Full Test Sequence

```bash
# 1. Test RunPod health
curl http://your-runpod-url:8000/health

# 2. Create censorship session
curl -X POST http://your-runpod-url:8000/session/create \
  -H "Content-Type: application/json" \
  -d '{"config": {"nsfw_detection": true, "text_detection": true}}'

# 3. Start server
cd server && npm start

# 4. Start stream
curl -X POST http://localhost:3001/stream/start \
  -H "Content-Type: application/json" \
  -d '{"roomName": "test-room-001", "broadcasterIdentity": "Broadcaster1", "censorshipConfig": {"nsfw_detection": true}}'

# 5. Open broadcaster in browser
# http://localhost:3000 -> Broadcaster mode -> test-room-001

# 6. Check stream status
curl http://localhost:3001/stream/status/test-room-001

# 7. Check server logs for:
# - [ProcessingBridge] Processing started
# - [FrameExtractor] Started egress
# - [FrameExtractor] Extracted frame N

# 8. End stream
curl -X POST http://localhost:3001/stream/end \
  -H "Content-Type: application/json" \
  -d '{"roomName": "test-room-001"}'
```

---

## Troubleshooting

### Issue: "Connection refused" to RunPod
```bash
# Check if RunPod URL is correct
echo $RUNPOD_URL

# Test with curl verbose
curl -v http://your-runpod-url:8000/health

# Check if port 8000 is exposed in RunPod dashboard
```

### Issue: "No active processing for room"
```bash
# Make sure you called /stream/start BEFORE broadcaster joins
# Order matters:
# 1. POST /stream/start
# 2. Broadcaster joins room
# 3. Webhook triggers track processing
```

### Issue: Egress not starting
```bash
# Check LiveKit credentials in server/.env
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
LIVEKIT_WS_URL=wss://your-project.livekit.cloud

# Check server logs for errors:
grep "FrameExtractor" server.log
grep "Error" server.log
```

### Issue: Frames not being extracted
```bash
# This is EXPECTED - FFmpeg integration not yet implemented
# You should see:
[FrameExtractor] test-room-001 - Extracted frame N

# But frames won't actually be sent to RunPod yet
# See ARCHITECTURE.md Phase 1 for implementation
```

---

## What's Working vs Not Working

| Test | Working? | Expected Behavior |
|------|----------|-------------------|
| Test 1: RunPod health | ✅ Yes | Returns healthy status |
| Test 2: Session creation | ✅ Yes | Creates session, no NumPy errors |
| Test 3: Frame processing | ✅ Yes | Processes uploaded image |
| Test 4: Token generation | ✅ Yes | Returns LiveKit token |
| Test 5: Stream start | ✅ Yes | Starts processing, creates session |
| Test 6: Stream status | ✅ Yes | Returns stream info |
| Test 7: End-to-end browser | ✅ Partial | Streaming works, egress starts |
| Test 8: Active streams | ✅ Yes | Lists active streams |
| Test 9: Processing bridge | ✅ Yes | Lifecycle works |
| Test 10: Client-side processing | ✅ Yes | 1 FPS frame capture |
| Test 11: End stream | ✅ Yes | Cleanup works, returns stats |
| Test 12: NumPy fix | ✅ Yes | No errors in logs |
| **Actual frame extraction** | ❌ No | Architecture in place, needs FFmpeg |
| **Processed streams to viewers** | ❌ No | Not implemented yet |

---

## Next Steps After Testing

If all tests pass:
1. ✅ NumPy fix is working
2. ✅ Architecture is in place
3. ✅ Egress lifecycle works
4. ⚠️ Need to implement FFmpeg frame extraction (ARCHITECTURE.md Phase 1)
5. ⚠️ Need to implement processed stream delivery (ARCHITECTURE.md Phase 2)

---

## Sample Data Summary

**Test Image**: `test-data/test-image.jpg` (placeholder image)
**Test Room**: `test-room-001`
**Test Broadcaster**: `John` (identity: `John-broadcaster`)
**Test Viewer**: `Alice` (identity: `Alice-viewer`)
**Test Session Config**:
```json
{
  "nsfw_detection": true,
  "text_detection": true,
  "audio_profanity": true,
  "blur_strength": 25
}
```

---

**Generated**: 2025-10-02
**Status**: Ready to test
**Environment**: Replace `your-runpod-url` with actual RunPod URL
