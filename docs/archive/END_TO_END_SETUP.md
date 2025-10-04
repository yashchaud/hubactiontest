# End-to-End Censorship Pipeline Setup Guide

## Complete Flow Verification & Setup

This document provides a comprehensive, step-by-step guide to get the real-time censorship pipeline fully operational.

---

## Architecture Overview

```
┌─────────────────┐
│   Broadcaster   │ Publishes video → Room "123"
└────────┬────────┘
         │
         ▼
    ┌────────────────────┐
    │  LiveKit Cloud     │
    │   (Room: 123)      │
    └────────┬───────────┘
             │
             │ Webhook: track_published
             ▼
    ┌────────────────────────┐
    │  Your Server           │
    │  (localhost:3001)      │
    │                        │
    │  1. Receive webhook    │
    │  2. Start Track Egress │◄─┐
    │     → MP4 file         │  │
    │  3. FFmpeg extracts    │  │
    │     frames (10 FPS)    │  │
    │  4. Send JPEG to RunPod│──┘
    └────────┬───────────────┘
             │
             │ HTTP POST /censorship/process-frame
             ▼
    ┌────────────────────────┐
    │  RunPod GPU Service    │
    │  (TensorFlow + CUDA)   │
    │                        │
    │  1. Text detection     │
    │  2. NSFW detection     │
    │  3. Apply blur         │
    │  4. Return blurred PNG │
    └────────┬───────────────┘
             │
             │ base64 blurred frame
             ▼
    ┌────────────────────────┐
    │  Frame Publisher       │
    │                        │
    │  1. Queue frame        │
    │  2. FFmpeg → RTMP      │
    │  3. Publish to         │
    │     processed-123      │
    └────────┬───────────────┘
             │
             ▼
    ┌────────────────────┐
    │  LiveKit Cloud     │
    │ (processed-123)    │
    └────────┬───────────┘
             │
             ▼
    ┌────────────────┐
    │    Viewers     │ See censored stream
    └────────────────┘
```

---

## Prerequisites Checklist

### ✅ Installed Software
- [ ] Node.js v16+ (`node --version`)
- [ ] FFmpeg installed and in PATH (`ffmpeg -version`)
- [ ] npm or yarn

### ✅ Accounts & Services
- [ ] LiveKit Cloud account (cloud.livekit.io)
- [ ] LiveKit project created
- [ ] RunPod account with GPU pod running
- [ ] ngrok or Cloudflare tunnel (for webhook reception)

### ✅ Environment Variables
Check your `server/.env` file has:
```bash
LIVEKIT_WS_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxx
PORT=3001

RUNPOD_SERVICE_URL=https://xxxxx.proxy.runpod.net
ENABLE_CENSORSHIP=true
```

**CRITICAL**: It must be `LIVEKIT_WS_URL` not `LIVEKIT_URL`!

---

## Step-by-Step Setup

### Step 1: Verify Environment Configuration

1. **Check server/.env**:
   ```bash
   cd server
   cat .env
   ```

2. **Verify variables are correct**:
   - `LIVEKIT_WS_URL` starts with `wss://`
   - API credentials match your LiveKit dashboard
   - RunPod URL is accessible

3. **Test RunPod connection**:
   ```bash
   curl https://your-runpod-url.proxy.runpod.net/health
   ```
   Should return: `{"status":"healthy"}`

### Step 2: Start the Server

1. **Install dependencies** (if not done):
   ```bash
   cd server
   npm install
   ```

2. **Start server**:
   ```bash
   npm start
   ```

3. **Verify startup logs show**:
   ```
   ✅ LiveKit configured: Yes ✅
   ✅ WebSocket URL: wss://your-project.livekit.cloud
   ✅ Censorship enabled: Yes ✅
   ✅ RunPod service: ONLINE ✅
   ```

### Step 3: Expose Server with ngrok

**Why needed**: LiveKit Cloud needs to send webhooks to your server. Since you're running locally, you need a public URL.

1. **Install ngrok**:
   - Download from: https://ngrok.com/download
   - Extract and add to PATH

2. **Start ngrok tunnel**:
   ```bash
   ngrok http 3001
   ```

3. **Copy the HTTPS URL**:
   ```
   Forwarding  https://abc123.ngrok-free.app -> http://localhost:3001
   ```
   Copy: `https://abc123.ngrok-free.app`

4. **Keep ngrok running** in a separate terminal

### Step 4: Configure LiveKit Webhooks

1. **Go to LiveKit Dashboard**:
   - Navigate to: https://cloud.livekit.io
   - Select your project
   - Go to **Settings** → **Webhooks**

2. **Add Webhook**:
   - Click "Add Webhook"
   - **URL**: `https://your-ngrok-url.ngrok-free.app/livekit/webhook`
     - Example: `https://abc123.ngrok-free.app/livekit/webhook`
   - **Important**: Include the `/livekit/webhook` path!

3. **Select Events** (check these boxes):
   - ✅ `room_started`
   - ✅ `room_finished`
   - ✅ `participant_joined`
   - ✅ `participant_left`
   - ✅ `track_published` **← CRITICAL**
   - ✅ `track_unpublished`
   - ✅ `egress_started`
   - ✅ `egress_ended`

4. **Save webhook configuration**

5. **Verify**:
   - LiveKit will send a test webhook
   - Check your server logs for: `[Webhook] Received event: ...`

### Step 5: Start the Client

1. **Open new terminal**:
   ```bash
   cd client
   npm install
   npm run dev
   ```

2. **Verify client starts**:
   ```
   ➜  Local:   http://localhost:3000/
   ```

3. **Open browser**: http://localhost:3000

### Step 6: Test the Complete Flow

#### Test 1: Start Broadcasting with Censorship

1. **In browser**:
   - Enter Room Name: `test-123`
   - Enter Your Name: `broadcaster1`
   - Click **"Join as Broadcaster"**

2. **Toggle censorship ON** (should be on by default)

3. **Click "Start Broadcast"**

4. **Check server logs** for:
   ```
   [API] Starting stream: test-123 by broadcaster1
   [StreamManager] Starting stream for room: test-123
   [ProcessingBridge] Starting processing for test-123
   [CensorshipProcessor] Session created: <session-id> for test-123
   [FramePublisher] Starting publisher for test-123
   ```

5. **Allow camera/microphone** when browser prompts

6. **Wait for webhook** (should arrive within 1-2 seconds):
   ```
   [Webhook] Received event: participant_joined
   [Webhook] Received event: track_published
   [Webhook] Starting server-side processing for broadcaster video track
   ```

7. **Watch for frame extraction**:
   ```
   [FrameExtractor] Starting frame extraction for test-123
   [FrameExtractor] test-123 - Found egress file: /tmp/livekit-test-123-xxxxx.mp4
   [FrameExtractor] test-123 - FFmpeg process started
   [FrameExtractor] Sending frame to RunPod...
   ```

8. **Look for RunPod processing**:
   ```
   [FrameExtractor] test-123 - Frame 1: 0 detection(s)
   [FrameExtractor] test-123 - Frame 2: 0 detection(s)
   [FramePublisher] Queued frame for publishing (queue: 1/30)
   ```

#### Test 2: Viewer Joins Censored Stream

1. **Open second browser tab/window**: http://localhost:3000

2. **Join as viewer**:
   - Room Name: `test-123` (same as broadcaster)
   - Your Name: `viewer1`
   - Click **"Join as Viewer"**

3. **Check viewer console** (F12 → Console):
   ```
   [Viewer] Censorship active - joining processed room: processed-test-123
   ```
   OR if censorship not ready yet:
   ```
   [Viewer] Joining raw room: test-123
   ```

4. **Verify video shows**:
   - Should see broadcaster's video
   - If censorship active, will be slightly delayed (~500ms)

#### Test 3: Trigger Censorship Detection

1. **Show text to camera**:
   - Write profanity on paper/screen
   - Hold up to camera
   - Check server logs for detections:
   ```
   [FrameExtractor] test-123 - Frame 45: 1 detection(s)
   [CensorshipProcessor] Detection: text blur applied
   ```

2. **Verify blur is applied**:
   - Viewer should see blurred text
   - Broadcaster sees original (raw feed)

---

## Troubleshooting

### Issue: "ECONNREFUSED" errors in server logs

**Cause**: `LIVEKIT_WS_URL` not set correctly

**Fix**:
1. Check `server/.env` has `LIVEKIT_WS_URL=` (not `LIVEKIT_URL=`)
2. Restart server
3. Verify logs show: `WebSocket URL: wss://... ✅`

---

### Issue: No webhooks received

**Symptoms**:
- Broadcaster can join and publish video
- But server logs never show `[Webhook] Received event: track_published`

**Cause**: Webhooks not configured or ngrok not running

**Fix**:
1. Verify ngrok is running: `curl https://your-ngrok-url.ngrok-free.app/health`
2. Check LiveKit dashboard webhook configuration
3. Webhook URL must include `/livekit/webhook` path
4. Check `track_published` event is enabled

---

### Issue: Frame extraction never starts

**Symptoms**:
- Webhooks received
- But no `[FrameExtractor] Starting extraction...` logs

**Cause**: Webhook handler not calling `processingBridge.startTrackProcessing()`

**Fix**:
1. Check webhook logs show: `[Webhook] Starting server-side processing...`
2. Verify broadcaster identity includes `broadcaster` string
3. Check track type is `VIDEO`

---

### Issue: "Could not find egress file"

**Symptoms**:
```
[FrameExtractor] Error: Could not find egress file for room test-123
```

**Cause**: LiveKit egress not creating MP4 file

**Fix**:
1. Check egress started: `[FrameExtractor] Started egress: <egress-id>`
2. Verify FFmpeg is installed: `ffmpeg -version`
3. Check temp directory permissions: `/tmp` on Linux/Mac, `%TEMP%` on Windows
4. Look for egress errors in logs

---

### Issue: RunPod connection fails

**Symptoms**:
```
[FrameExtractor] Error sending frame to RunPod: ECONNREFUSED
```

**Cause**: RunPod service not running or URL wrong

**Fix**:
1. Test RunPod health: `curl $RUNPOD_SERVICE_URL/health`
2. Verify `RUNPOD_SERVICE_URL` in `.env` is correct
3. Check RunPod pod is running in RunPod dashboard
4. Ensure RunPod expose port 8000 is enabled

---

### Issue: Viewers see raw stream instead of censored

**Symptoms**:
- Viewers join `test-123` instead of `processed-test-123`
- See original stream with no blur

**Cause**: Censorship pipeline not fully active when viewer joins

**Current Behavior**:
- Viewers check if censorship is active
- If frame publisher not ready, join raw room
- This is expected during startup

**Fix**:
- Wait 5-10 seconds after broadcaster starts
- Then have viewers join
- They should auto-join processed room

---

## Verification Checklist

After setup, verify each component:

### ✅ Server Started
- [ ] Server running on port 3001
- [ ] Logs show: `LiveKit configured: Yes ✅`
- [ ] Logs show: `RunPod service: ONLINE ✅`

### ✅ Webhook Reception
- [ ] ngrok tunnel active
- [ ] Webhook configured in LiveKit dashboard
- [ ] Test webhook shows in server logs

### ✅ Censorship Pipeline
- [ ] Broadcaster can start stream with censorship ON
- [ ] Webhooks received: `track_published`
- [ ] Frame extraction starts
- [ ] Frames sent to RunPod
- [ ] Frame publisher queuing frames

### ✅ Viewer Experience
- [ ] Viewers can join room
- [ ] Auto-detects censored vs raw room
- [ ] Video plays smoothly
- [ ] Blur applied when inappropriate content shown

---

## Production Deployment Notes

For production (not localhost):

1. **No ngrok needed**: Deploy server to cloud with public IP
2. **Webhook URL**: Point directly to `https://your-domain.com/livekit/webhook`
3. **HTTPS required**: LiveKit webhooks require HTTPS
4. **Environment variables**: Set via hosting platform (Heroku, AWS, etc.)
5. **FFmpeg**: Ensure installed on production server
6. **RunPod**: Use dedicated GPU pod, not shared

---

## Expected Performance

- **Latency**: ~300-500ms added for censorship processing
- **Frame rate**: 10 FPS processing (configurable via `PROCESSING_FPS`)
- **Detection time**: ~50-100ms per frame on GPU
- **Total pipeline**: Broadcaster → Processing → Viewer ~500ms delay

---

## Support

If issues persist:

1. **Check logs** in detail - every component logs extensively
2. **Verify each step** in this guide
3. **Test components individually**:
   - Server health: `curl http://localhost:3001/health`
   - RunPod health: `curl $RUNPOD_SERVICE_URL/health`
   - Webhook reception: Check ngrok dashboard
4. **Review** [WEBHOOK_SETUP.md](WEBHOOK_SETUP.md) for webhook-specific help
5. **Check** [CLEANUP_SUMMARY.md](CLEANUP_SUMMARY.md) for project structure

---

## Quick Start Commands

```bash
# Terminal 1: Start server
cd server
npm start

# Terminal 2: Start ngrok
ngrok http 3001
# Copy the HTTPS URL and configure in LiveKit dashboard

# Terminal 3: Start client
cd client
npm run dev

# Open browser: http://localhost:3000
```

That's it! Your real-time censorship pipeline should now be fully operational. 🎉
