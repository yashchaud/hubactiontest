# LiveKit Cloud Livestreaming with Real-Time Censorship

A production-ready livestreaming application with AI-powered real-time content censorship using LiveKit Cloud, React (Vite) frontend, Node.js backend, and RunPod GPU processing.

## Features

- **Broadcaster Mode**: Stream your camera and microphone to a room
- **Viewer Mode**: Watch live streams with censored content in real-time
- **Real-Time Censorship**: GPU-accelerated detection and blurring of sensitive content
  - Text/profanity detection and blurring
  - NSFW image detection and blurring
  - Audio profanity filtering
- **Sub-100ms Latency**: WebRTC-based real-time communication
- **Dual Room Architecture**: Raw broadcaster stream → Processing pipeline → Censored viewer stream
- **Production-Ready**: Automatic retries, frame buffering, FFmpeg crash recovery

## Prerequisites

- Node.js (v16 or higher)
- LiveKit Cloud account (free tier available)
- RunPod account with GPU pod (for censorship processing)
- Docker (for RunPod service deployment)
- FFmpeg installed on server
- npm or yarn

## Architecture

```
┌──────────────┐      ┌─────────────────┐      ┌──────────────────┐
│  Broadcaster │─────>│  LiveKit Room   │─────>│ Frame Extractor  │
│   (WebRTC)   │      │   (Raw Stream)  │      │    (FFmpeg)      │
└──────────────┘      └─────────────────┘      └──────────────────┘
                                                         │
                                                         ▼
                                              ┌──────────────────┐
                                              │  RunPod Service  │
                                              │  (GPU Processing)│
                                              │  - Text Blur     │
                                              │  - NSFW Blur     │
                                              │  - Profanity Fil │
                                              └──────────────────┘
                                                         │
                                                         ▼
                                              ┌──────────────────┐
┌──────────────┐      ┌─────────────────┐   │ Frame Publisher  │
│    Viewer    │<─────│  LiveKit Room   │<──│ (RTMP Ingress)   │
│   (WebRTC)   │      │(Processed Stream)│   └──────────────────┘
└──────────────┘      └─────────────────┘
```

## Quick Start

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for complete deployment instructions.

## Setup Instructions

### 1. Create LiveKit Cloud Account

1. Go to [cloud.livekit.io](https://cloud.livekit.io)
2. Sign up for a free account
3. Create a new project
4. Navigate to Settings → Keys
5. Create a new API key pair
6. Copy the following:
   - API Key
   - API Secret
   - WebSocket URL (e.g., `wss://your-project.livekit.cloud`)

### 2. Configure Backend

1. Navigate to the server directory:
   ```bash
   cd server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env` file from example:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` and add your LiveKit credentials:
   ```
   LIVEKIT_API_KEY=your_api_key_here
   LIVEKIT_API_SECRET=your_api_secret_here
   LIVEKIT_WS_URL=wss://your-project.livekit.cloud
   PORT=3001
   ```

5. Start the server:
   ```bash
   npm start
   ```

   Server will run on `http://localhost:3001`

### 3. Configure Frontend

1. Open a new terminal and navigate to the client directory:
   ```bash
   cd client
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env` file from example:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` if needed (default should work):
   ```
   VITE_SERVER_URL=http://localhost:3001
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

   Client will run on `http://localhost:3000`

## Usage

### Broadcasting

1. Open your browser to `http://localhost:3000`
2. Enter a room name (e.g., "test-room")
3. Enter your name
4. Click "Join as Broadcaster"
5. Allow camera and microphone permissions
6. You're now live streaming!

### Viewing

1. Open another browser tab/window to `http://localhost:3000`
2. Enter the **same room name** as the broadcaster
3. Enter your name
4. Click "Join as Viewer"
5. You'll see the broadcaster's live stream

## Project Structure

```
pipeline_Agent/
├── server/                        # Backend (Node.js/Express)
│   ├── server.js                 # Main API server
│   ├── roomManager.js            # Room state management
│   ├── streamManager.js          # Stream lifecycle control
│   ├── webhooks.js               # LiveKit webhook handler
│   ├── services/
│   │   ├── frameExtractor.js     # FFmpeg frame extraction
│   │   ├── framePublisher.js     # RTMP stream publishing
│   │   ├── processingBridge.js   # Processing pipeline orchestration
│   │   └── censorshipRulesService.js
│   └── processors/
│       ├── preProcessor.js       # Pre-stream processing
│       └── postProcessor.js      # Post-stream processing
│
├── client/                       # Frontend (React/Vite)
│   ├── src/
│   │   ├── App.jsx              # Main router
│   │   ├── Broadcaster.jsx      # Broadcaster component
│   │   ├── Viewer.jsx           # Viewer component (joins processed rooms)
│   │   └── index.css            # Styles
│   └── package.json
│
├── runpod-service/              # GPU Processing Service
│   ├── main.py                  # FastAPI server
│   ├── Dockerfile               # Production Docker image
│   ├── Dockerfile.optimized     # Optimized build (recommended)
│   ├── requirements.txt         # Python dependencies
│   └── models/                  # ML models (auto-downloaded)
│
├── scripts/                     # Test and utility scripts
│   ├── WORKING_TESTS.txt       # Copy-paste test commands
│   └── *.txt                   # Other test scripts
│
├── archive/                     # Archived/deprecated files
│   ├── docs/                   # Old documentation
│   └── unused-services/        # Unused code
│
├── README.md                    # This file
├── DEPLOYMENT_GUIDE.md         # Deployment instructions
├── ARCHITECTURE.md             # System architecture details
├── CLAUDE.md                   # AI assistant context
└── TEST_COMMANDS.md            # Testing guide
```

## How It Works

### Without Censorship (Simple Mode)
1. **Authentication**: Client requests token from backend
2. **Connection**: Client connects to LiveKit Cloud using token
3. **Streaming**: Broadcaster publishes → Viewers subscribe directly

### With Censorship (Production Mode)
1. **Broadcaster Stream**: Publishes to raw room (e.g., `room-123`)
2. **Frame Extraction**: Server extracts frames at 10 FPS via FFmpeg from RTMP egress
3. **GPU Processing**: Frames sent to RunPod service for:
   - Text detection & blur (Keras-OCR)
   - NSFW detection & blur (NudeNet)
   - Profanity filtering (Better-Profanity)
4. **Frame Publishing**: Blurred frames published to processed room via RTMP ingress (e.g., `processed-room-123`)
5. **Viewer Stream**: Viewers join processed room and see censored content
6. **Latency**: ~300-500ms added latency for processing (still real-time)

## Tech Stack

### Frontend
- React 18, Vite
- @livekit/components-react
- LiveKit WebRTC client

### Backend (Node.js)
- Express.js
- livekit-server-sdk (RoomServiceClient, EgressClient, IngressClient)
- FFmpeg (frame extraction & publishing)
- WebSocket for real-time events

### AI Processing (Python/RunPod)
- FastAPI
- TensorFlow 2.15 + CUDA 11.8
- Keras-OCR (text detection)
- NudeNet (NSFW detection)
- Better-Profanity (profanity filtering)
- OpenCV (image processing)

### Infrastructure
- LiveKit Cloud (WebRTC streaming)
- RunPod (GPU processing)
- Docker (containerization)

## Troubleshooting

### "Failed to connect to server"
- Make sure the backend server is running on port 3001
- Check that `.env` files are configured correctly

### Camera/Microphone not working
- Check browser permissions
- Ensure you're using HTTPS or localhost (required for WebRTC)

### No video showing as viewer
- Make sure broadcaster has joined the same room name
- Check that broadcaster has allowed camera/microphone permissions

### Censorship not working
- Verify RunPod service is running: `curl http://your-runpod:8000/health`
- Check server logs for frame extraction errors
- Ensure FFmpeg is installed: `ffmpeg -version`
- Verify `RUNPOD_SERVICE_URL` in server `.env`

### NumPy compatibility errors
- RunPod service requires NumPy <2.0.0 for TensorFlow 2.15
- Rebuild Docker image if you see NumPy-related crashes

### High latency in censored stream
- Check GPU processing time in logs
- Reduce `PROCESSING_FPS` in frameExtractor.js (currently 10 FPS)
- Ensure RunPod pod has sufficient GPU resources

## API Endpoints

### POST /token
Generate an access token for LiveKit

**Request:**
```json
{
  "roomName": "test-room",
  "participantName": "John",
  "role": "broadcaster" // or "viewer"
}
```

**Response:**
```json
{
  "token": "eyJhbGc...",
  "wsUrl": "wss://your-project.livekit.cloud"
}
```

### GET /health
Health check endpoint

**Response:**
```json
{
  "status": "ok"
}
```

### POST /stream/start
Start stream with censorship processing

**Request:**
```json
{
  "roomName": "test-room",
  "broadcasterName": "John"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "sess_abc123",
  "processedRoomName": "processed-test-room"
}
```

### POST /stream/end
End stream and cleanup

**Request:**
```json
{
  "roomName": "test-room"
}
```

### GET /stream/status/:roomName
Get stream processing status

**Response:**
```json
{
  "active": true,
  "roomName": "test-room",
  "frameCount": 1250,
  "detectionCount": 15,
  "publisherActive": true,
  "publishedFrames": 1200
}
```

## Production Deployment

### Prerequisites
- LiveKit Cloud account
- RunPod account with GPU pod (RTX 3090/4090 recommended)
- Server with FFmpeg installed
- Docker on RunPod

### Steps
1. **Deploy RunPod Service**:
   ```bash
   cd runpod-service
   docker build -f Dockerfile.optimized -t censorship-service:latest .
   # Deploy to RunPod (see DEPLOYMENT_GUIDE.md)
   ```

2. **Configure Backend**:
   ```bash
   cd server
   npm install
   # Set environment variables (RUNPOD_SERVICE_URL, LIVEKIT credentials)
   npm start
   ```

3. **Build & Deploy Frontend**:
   ```bash
   cd client
   npm install
   npm run build
   # Deploy dist/ to CDN or static hosting
   ```

4. **Environment Variables**:
   - Server: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_WS_URL`, `RUNPOD_SERVICE_URL`
   - Client: `VITE_SERVER_URL`
   - RunPod: GPU with CUDA 11.8+

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for detailed instructions.

## Resources

- [LiveKit Documentation](https://docs.livekit.io)
- [LiveKit Cloud](https://cloud.livekit.io)
- [LiveKit React Components](https://docs.livekit.io/reference/components/react/)

## License

MIT