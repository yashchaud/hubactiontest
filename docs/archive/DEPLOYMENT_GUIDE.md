# 🚀 Complete Deployment Guide - LiveKit Censorship System

## Overview

You have **3 components** to deploy:
1. **RunPod GPU Service** - Runs ML models (text/NSFW detection)
2. **Backend Server (Node.js)** - Handles LiveKit tokens, webhooks, orchestration
3. **Frontend Client (React)** - Broadcaster and viewer UI

---

## ⚡ STEP 1: Deploy RunPod GPU Service

### 1.1 Go to RunPod

1. Open https://www.runpod.io/console/pods
2. Click **"+ Deploy"** or **"GPU Pods"**

### 1.2 Configure Pod

**Template Settings:**
- **Container Image:** `yashchaud/censorship-service:latest`
- **Container Disk:** `25 GB`
- **Volume Disk:** `0 GB` (not needed)

**GPU Selection:**
- **Recommended:** RTX 3090 or RTX 4090 ($0.30-0.50/hour)
- **Minimum:** RTX 3080 (10GB VRAM)
- **Don't use:** GTX 1080 Ti or lower (too little VRAM)

**Expose Ports:**
- **Internal Port:** `8000`
- **External Port:** Check **"HTTP"** (gets you a public URL)

**Environment Variables** (click "Edit Template" → "Environment Variables"):
```
ENABLE_TEXT_DETECTION=true
ENABLE_NSFW_DETECTION=true
ENABLE_AUDIO_PROFANITY=true
LOG_LEVEL=info
```

### 1.3 Deploy!

1. Click **"Deploy"**
2. Wait ~30 seconds for pod to start
3. Wait ~3-5 minutes for models to download (first boot only!)

### 1.4 Get Your RunPod URL

Once running, you'll see:
```
Status: Running
HTTP Service: https://abc123xyz-8000.proxy.runpod.net
```

**Copy this URL!** You'll need it for the backend server.

### 1.5 Test RunPod Service

Open your browser or use curl:
```bash
curl https://YOUR_RUNPOD_URL/health
```

**Expected response:**
```json
{
  "status": "healthy",
  "models_loaded": {
    "text_detector": true,
    "nsfw_detector": true,
    "audio_profanity_detector": true,
    "object_tracker": true,
    "blur_applicator": true
  },
  "active_sessions": 0
}
```

✅ **If you see this, RunPod is working!**

---

## 🖥️ STEP 2: Deploy Backend Server (Node.js)

### 2.1 Configure Environment Variables

Navigate to server folder:
```bash
cd "e:\New folder (3)\pipeline_Agent\server"
```

Create `.env` file:
```bash
# Copy example
cp .env.example .env

# Edit with your values
notepad .env
```

**Required values:**
```env
# LiveKit Credentials (get from https://cloud.livekit.io)
LIVEKIT_API_KEY=your_api_key_here
LIVEKIT_API_SECRET=your_api_secret_here
LIVEKIT_WS_URL=wss://your-project.livekit.cloud

# Server Port
PORT=3001

# RunPod Service URL (from Step 1.4)
RUNPOD_SERVICE_URL=https://abc123xyz-8000.proxy.runpod.net

# Enable Censorship
ENABLE_CENSORSHIP=true
```

### 2.2 Install Dependencies

```bash
npm install
```

### 2.3 Start Server

```bash
npm start
```

**Expected output:**
```
🚀 LiveKit Webinar Server Started

Server running on port 3001

📡 Stream Endpoints:
  - Token generation: POST http://localhost:3001/token
  - Webhook receiver: POST http://localhost:3001/livekit/webhook
  ...

🔒 Censorship Endpoints:
  - Get rules:        GET  http://localhost:3001/censorship/rules
  - Update rules:     POST http://localhost:3001/censorship/rules
  ...

⚙️  Configuration:
  - LiveKit configured: Yes ✅
  - WebSocket URL: wss://your-project.livekit.cloud
  - Censorship enabled: Yes ✅
  - RunPod service URL: https://abc123xyz-8000.proxy.runpod.net ✅

🔍 Checking RunPod censorship service...
  - RunPod service: ONLINE ✅
```

✅ **If you see "RunPod service: ONLINE ✅", backend is working!**

---

## 🎨 STEP 3: Deploy Frontend Client (React)

### 3.1 Configure Environment Variables

Navigate to client folder:
```bash
cd "e:\New folder (3)\pipeline_Agent\client"
```

Create `.env` file:
```bash
# Copy example
cp .env.example .env

# Edit with backend URL
notepad .env
```

**Set this value:**
```env
VITE_SERVER_URL=http://localhost:3001
```

### 3.2 Install Dependencies

```bash
npm install
```

### 3.3 Start Development Server

```bash
npm run dev
```

**Expected output:**
```
  VITE v5.4.10  ready in 500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

### 3.4 Open Browser

Go to: http://localhost:5173

You should see:
```
🎥 LiveKit Webinar
Professional live streaming made simple

[Enter Room Name]
[Enter Your Name]

📡 Start Broadcasting     👁️ Watch Stream
```

✅ **If you see this, frontend is working!**

---

## 🧪 STEP 4: Test End-to-End Censorship

### Test 1: Basic Streaming (No Censorship)

1. **Open browser:** http://localhost:5173
2. **Enter:**
   - Room Name: `test-room`
   - Your Name: `Broadcaster1`
3. **Click:** "📡 Start Broadcasting"
4. **Allow camera/microphone**
5. **You should see:** Your video feed with "LIVE" badge

**Open another browser tab/window:**
1. Go to: http://localhost:5173
2. Enter same room: `test-room`
3. Your Name: `Viewer1`
4. Click "👁️ Watch Stream"
5. **You should see:** The broadcaster's video

✅ **If this works, basic streaming is working!**

---

### Test 2: Text Censorship

**What to test:**
1. **Start broadcasting** (as above)
2. **Hold up a sign** with profane text (e.g., "fuck", "shit", "damn")
3. **The text should be blurred** in the viewer's stream

**Check backend logs:**
```bash
# In server terminal, you should see:
[Censorship] Text detector found 1 profane text(s)
[Censorship] Processing frame for test-room
[ProcessingBridge] test-room: 1 detection(s) in frame 123
```

✅ **If text is blurred, censorship is working!**

---

### Test 3: NSFW Censorship

**What to test:**
1. **Start broadcasting**
2. **Show inappropriate content** (use test images or draw NSFW content)
3. **The NSFW content should be blurred**

**Check backend logs:**
```bash
[Censorship] NSFW detector found 1 detection(s)
[Censorship] Detection type: exposed_breast_f (confidence: 0.95)
```

✅ **If NSFW is blurred, full system is working!**

---

## 🔧 Troubleshooting

### Issue 1: "RunPod service: OFFLINE ❌"

**Check:**
1. Is RunPod pod running? (go to RunPod dashboard)
2. Is the URL correct in server/.env?
3. Test directly: `curl https://YOUR_RUNPOD_URL/health`

**Fix:**
```bash
# Update server/.env with correct URL
RUNPOD_SERVICE_URL=https://abc123xyz-8000.proxy.runpod.net

# Restart server
npm start
```

---

### Issue 2: "Failed to get token"

**Check:**
1. Are LiveKit credentials correct in server/.env?
2. Is server running? (http://localhost:3001/health)

**Fix:**
```bash
# Get new credentials from https://cloud.livekit.io
# Update server/.env
LIVEKIT_API_KEY=new_key
LIVEKIT_API_SECRET=new_secret

# Restart server
npm start
```

---

### Issue 3: Models downloading slowly on RunPod

**This is normal on first boot!**
- Keras-OCR: ~400MB (2-3 min)
- NudeNet: ~200MB (1-2 min)
- Whisper: ~500MB (2-3 min)

**Total first boot:** 5-8 minutes

**After first boot:** Models are cached, restarts are instant!

**Check progress:**
Go to RunPod dashboard → Your pod → Logs
You'll see:
```
Loading Keras-OCR pipeline...
Downloading model...
Keras-OCR pipeline loaded successfully
```

---

### Issue 4: Censorship not working

**Check:**
1. Is `ENABLE_CENSORSHIP=true` in server/.env?
2. Is RunPod service responding? (check /health)
3. Are confidence thresholds too high?

**Fix confidence thresholds:**

Edit `server/config/censorshipRules.json`:
```json
{
  "global": {
    "confidenceThresholds": {
      "text": 0.5,    // Lower = more detections (was 0.7)
      "nsfw": 0.7,    // Lower = more detections (was 0.85)
      "audio": 0.6    // Lower = more detections (was 0.8)
    }
  }
}
```

Restart server.

---

## 📊 System Architecture

```
┌─────────────────┐
│  React Client   │  http://localhost:5173
│  (Broadcaster)  │
└────────┬────────┘
         │
         │ WebRTC
         ▼
┌─────────────────┐
│  LiveKit Cloud  │  wss://your-project.livekit.cloud
│                 │
└────────┬────────┘
         │
         │ Webhooks + API
         ▼
┌─────────────────┐
│  Node.js Server │  http://localhost:3001
│   (Backend)     │
└────────┬────────┘
         │
         │ Frame Processing
         ▼
┌─────────────────┐
│ RunPod GPU Pod  │  https://abc123-8000.proxy.runpod.net
│  (ML Models)    │
└─────────────────┘
```

---

## 🎯 Next Steps After Testing

### 1. Configure Censorship Rules

Edit `server/config/censorshipRules.json`:

```json
{
  "text": {
    "profanityList": [
      "fuck", "shit", "damn", "ass", "bitch",
      "custom-word-1", "custom-word-2"
    ]
  },
  "nsfw": {
    "categories": {
      "EXPOSED_GENITALIA_F": {
        "enabled": true,
        "censorshipLevel": "critical",
        "blurMethod": "black_box"
      },
      "EXPOSED_BREAST_F": {
        "enabled": true,
        "censorshipLevel": "high",
        "blurMethod": "pixelate"
      }
    }
  }
}
```

### 2. Deploy to Production

**Backend (Node.js):**
- Deploy to Heroku, Railway, or Render
- Update `LIVEKIT_WS_URL` with production LiveKit project
- Set environment variables in hosting platform

**Frontend (React):**
- Build: `npm run build`
- Deploy to Vercel, Netlify, or Cloudflare Pages
- Update `VITE_SERVER_URL` to production backend URL

**RunPod:**
- Already deployed! Just keep it running
- Consider upgrading to RTX 4090 for production (faster)

### 3. Monitor Performance

**Backend Metrics:**
- Check logs for censorship detections
- Monitor API response times
- Watch for RunPod service errors

**RunPod Metrics:**
- Check GPU utilization (should be 50-80%)
- Monitor VRAM usage (should be <8GB)
- Watch for model loading errors in logs

---

## 💰 Cost Estimate (Production)

| Service | Cost | Notes |
|---------|------|-------|
| **RunPod RTX 3090** | $0.34/hour | 24/7 = $245/month |
| **RunPod RTX 4090** | $0.54/hour | 24/7 = $389/month |
| **Backend Hosting** | Free-$20/month | Render/Railway free tier |
| **Frontend Hosting** | Free | Vercel/Netlify free tier |
| **LiveKit Cloud** | Free-$99/month | 1000 min free, then $99/mo |

**Minimum monthly cost:** ~$245/month (if running 24/7)

**Cost saving tips:**
- Only run RunPod when streaming (start/stop on demand)
- Use Spot instances on RunPod (50% cheaper, may be interrupted)
- Use RTX 3080 instead of 3090 (20% cheaper)

---

## ✅ Summary Checklist

Before going live, verify:

- [ ] RunPod pod is running and healthy
- [ ] Backend server is running (port 3001)
- [ ] Frontend is accessible (port 5173)
- [ ] Can create broadcaster session
- [ ] Can create viewer session
- [ ] Text censorship is working (blur profanity)
- [ ] NSFW censorship is working (blur inappropriate content)
- [ ] Check backend logs for errors
- [ ] Check RunPod logs for model loading
- [ ] Test with multiple viewers (load testing)

---

**Ready to go live? Let me know if you hit any issues!** 🚀
