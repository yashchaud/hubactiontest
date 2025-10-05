# Hybrid Pipeline Setup Guide

Complete guide to configuring and running the 3-lane hybrid video censorship pipeline.

---

## 🚀 Quick Start (5 Minutes)

### 1. Environment Configuration

**Server (`.env`):**
```env
# LiveKit credentials (required)
LIVEKIT_API_KEY=your_api_key_here
LIVEKIT_API_SECRET=your_api_secret_here
LIVEKIT_WS_URL=wss://your-project.livekit.cloud

# Hybrid Pipeline (enable new architecture)
USE_HYBRID_AGENT=true

# Triton Inference Server
TRITON_GRPC_URL=localhost:8001

# Lane 1: Live Publishing
BLUR_METHOD=pixelation
PIXEL_SIZE=20

# Lane 2: Async Verification
BATCH_MAX_WAIT_MS=30
BATCH_SIZE=8

# Lane 3: Tracking & Prediction
KALMAN_ENABLED=true
OPTICAL_FLOW_ENABLED=false  # Optional (Phase 5)
CONFIDENCE_DECAY_RATE=0.85
MIN_CONFIDENCE=0.3
BLUR_DILATION_PX=8
```

**Client (`.env`):**
```env
VITE_SERVER_URL=http://localhost:3001
```

**RunPod Service (`.env`):**
```env
# Triton config
TRITON_INSTANCES=3
TENSORRT_PRECISION=FP16
MAX_BATCH_SIZE=8
DYNAMIC_BATCHING=true

# Model settings
LOAD_NSFW_DETECTOR=true
LOAD_TEXT_DETECTOR=false
LOAD_AUDIO_DETECTOR=false
```

### 2. Install Dependencies

```bash
# Server
cd server
npm install

# Client
cd ../client
npm install

# RunPod (if not using Docker)
cd ../runpod-service
pip install -r requirements.txt
```

### 3. Convert Model to TensorRT

```bash
cd runpod-service/optimizers

# Export NudeNet to ONNX and convert to TensorRT
python convert_to_tensorrt.py \
  --export-onnx \
  --precision FP16 \
  --batch-size 8 \
  --workspace 2 \
  --test

# Copy engine to Triton model repository
cp nudenet_trt.plan ../triton/models/nudenet_trt/1/model.plan
```

### 4. Start Services

**Terminal 1 - Triton Server:**
```bash
docker run --gpus all --rm \
  -p 8000:8000 -p 8001:8001 -p 8002:8002 \
  -v $(pwd)/runpod-service/triton/models:/models \
  nvcr.io/nvidia/tritonserver:23.10-py3 \
  tritonserver --model-repository=/models
```

**Terminal 2 - Backend:**
```bash
cd server
npm start
```

**Terminal 3 - Frontend:**
```bash
cd client
npm run dev
```

### 5. Configure LiveKit Webhooks

1. Go to: `https://cloud.livekit.io/projects/[your-project]/settings`
2. Add webhook URL: `https://your-domain.com/livekit/webhook`
3. Enable events:
   - ✓ `participant_joined`
   - ✓ `participant_left`
   - ✓ `track_published`
   - ✓ `room_finished`

**For local testing:**
```bash
# Install ngrok
brew install ngrok  # or download from ngrok.com

# Expose port 3001
ngrok http 3001

# Use the HTTPS URL in LiveKit webhook config:
# https://abc123.ngrok.io/livekit/webhook
```

### 6. Test the System

1. Open browser: `http://localhost:3000`
2. Join as broadcaster
3. Open incognito/another browser: `http://localhost:3000`
4. Join as viewer (same room name)
5. Verify censored video stream

---

## 📋 Configuration Reference

### Server Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_HYBRID_AGENT` | `true` | Enable hybrid 3-lane architecture |
| `TRITON_GRPC_URL` | `localhost:8001` | Triton gRPC endpoint |
| `KALMAN_ENABLED` | `true` | Enable Kalman tracking |
| `OPTICAL_FLOW_ENABLED` | `false` | Enable optical flow (Phase 5) |
| `BATCH_MAX_WAIT_MS` | `30` | Max queue wait time (10-50ms) |
| `BATCH_SIZE` | `8` | Max batch size (4-8 optimal) |
| `CONFIDENCE_DECAY_RATE` | `0.85` | Per-frame decay (0.8-0.9) |
| `MIN_CONFIDENCE` | `0.3` | Remove threshold (0.2-0.4) |
| `BLUR_DILATION_PX` | `8` | Safety margin (4-16px) |
| `BLUR_METHOD` | `pixelation` | `pixelation` or `gaussian` |
| `PIXEL_SIZE` | `20` | Pixelation size (15-30) |

### Triton Configuration

**File:** `runpod-service/triton/models/nudenet_trt/config.pbtxt`

Key settings:
- `max_batch_size`: 8 (matches BATCH_SIZE)
- `max_queue_delay_microseconds`: 30000 (30ms)
- `instance_group.count`: 3 (prevent blocking)
- `precision_mode`: FP16 (3-5x speedup)

### Performance Tuning

**For lower latency (<20ms publish):**
```env
BATCH_MAX_WAIT_MS=20
BATCH_SIZE=4
BLUR_METHOD=pixelation
PIXEL_SIZE=15
```

**For higher accuracy:**
```env
BATCH_MAX_WAIT_MS=40
BATCH_SIZE=8
CONFIDENCE_DECAY_RATE=0.9
MIN_CONFIDENCE=0.2
BLUR_DILATION_PX=16
```

**For multiple streams:**
```env
# Increase Triton instances in config.pbtxt
instance_group [{ count: 4 }]

# Reduce batch size per stream
BATCH_SIZE=4
```

---

## 🔧 Troubleshooting

### Hybrid Agent Not Connecting

**Symptoms:** No censored video track visible

**Solutions:**
1. Check environment: `USE_HYBRID_AGENT=true`
2. Verify webhook is receiving events:
   ```bash
   curl http://localhost:3001/webhook/diagnostics
   ```
3. Check server logs for connection errors
4. Verify LiveKit credentials in `.env`

### High Publish Latency (>50ms)

**Symptoms:** Lag in video stream

**Solutions:**
1. Check Kalman is enabled: `KALMAN_ENABLED=true`
2. Reduce batch wait: `BATCH_MAX_WAIT_MS=20`
3. Use pixelation blur: `BLUR_METHOD=pixelation`
4. Monitor GPU usage: `nvidia-smi -l 1`

### Frame Leaks Detected

**Symptoms:** Unblurred content visible for 1-2 frames

**Solutions:**
1. Increase confidence decay: `CONFIDENCE_DECAY_RATE=0.9`
2. Increase blur dilation: `BLUR_DILATION_PX=16`
3. Lower min confidence: `MIN_CONFIDENCE=0.2`
4. Verify Kalman tracking is working (check logs)

### Triton Connection Errors

**Symptoms:** `Triton client not initialized`

**Solutions:**
1. Verify Triton is running:
   ```bash
   curl http://localhost:8000/v2/health/ready
   ```
2. Check gRPC port: `TRITON_GRPC_URL=localhost:8001`
3. Verify model is loaded:
   ```bash
   curl http://localhost:8000/v2/models/nudenet_trt
   ```
4. Check TensorRT engine exists:
   ```bash
   ls runpod-service/triton/models/nudenet_trt/1/model.plan
   ```

### Queue Overflow

**Symptoms:** Frames being dropped, `frame:dropped` events

**Solutions:**
1. Increase Triton instances (edit `config.pbtxt`)
2. Reduce batch wait: `BATCH_MAX_WAIT_MS=20`
3. Increase max pending: Edit `ContinuousBatchCollector` max

Pending (15 → 20)
4. Check GPU is not saturated: `nvidia-smi`

---

## 📊 Monitoring

### Server Endpoints

**Webhook diagnostics:**
```bash
curl http://localhost:3001/webhook/diagnostics
```

**Hybrid agent status:**
```bash
curl http://localhost:3001/censorship/processing
```

**Server health:**
```bash
curl http://localhost:3001/health
```

### Triton Metrics

**Model statistics:**
```bash
curl http://localhost:8000/v2/models/nudenet_trt/stats
```

**Prometheus metrics:**
```bash
curl http://localhost:8002/metrics | grep nv_inference
```

### Key Metrics to Monitor

1. **Publish Latency** (target: <30ms)
   - Check: LivePublisher stats in logs
   - Alert if: >50ms consistently

2. **Queue Depth** (target: <15)
   - Check: BatchCollector status
   - Alert if: >25 frames

3. **Tracking Accuracy** (target: >90%)
   - Check: Kalman tracker stats
   - Alert if: <80% confidence

4. **Frame Drop Rate** (target: <1%)
   - Check: BatchCollector dropped frames
   - Alert if: >5% dropped

---

## 🚀 Production Deployment

### 1. SSL/TLS Setup

```bash
# Use Let's Encrypt with Nginx
sudo certbot --nginx -d your-domain.com
```

### 2. Process Manager

```bash
# Install PM2
npm install -g pm2

# Start server
cd server
pm2 start npm --name "livekit-server" -- start

# Start client (or use nginx to serve static build)
cd client
npm run build
pm2 serve dist 3000 --name "livekit-client"

# Save PM2 config
pm2 save
pm2 startup
```

### 3. Docker Compose (Recommended)

```yaml
version: '3.8'

services:
  triton:
    image: nvcr.io/nvidia/tritonserver:23.10-py3
    command: tritonserver --model-repository=/models
    volumes:
      - ./runpod-service/triton/models:/models
    ports:
      - "8000:8000"
      - "8001:8001"
      - "8002:8002"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  server:
    build: ./server
    ports:
      - "3001:3001"
    environment:
      - USE_HYBRID_AGENT=true
      - TRITON_GRPC_URL=triton:8001
    depends_on:
      - triton

  client:
    build: ./client
    ports:
      - "3000:80"
    depends_on:
      - server
```

### 4. Environment Secrets

Use a secrets manager (AWS Secrets Manager, HashiCorp Vault):

```bash
# Example: AWS Secrets Manager
export LIVEKIT_API_KEY=$(aws secretsmanager get-secret-value \
  --secret-id livekit/api-key --query SecretString --output text)
```

---

## 📝 Development Workflow

### Branch Strategy

```bash
# Main branches
main          # Production
develop       # Development
feature/*     # Features (hybrid-pipeline, etc)

# Current branch
feature/hybrid-pipeline  # Hybrid implementation
```

### Testing Changes

```bash
# Test locally
npm run dev

# Test with ngrok
ngrok http 3001

# Test Triton
curl http://localhost:8000/v2/health/ready

# View logs
tail -f server/logs/app.log
```

### Debugging

**Enable verbose logging:**
```env
LOG_LEVEL=debug
KALMAN_DEBUG=true
BATCH_DEBUG=true
```

**Check component status:**
```javascript
// In browser console (client)
console.log(window.livekitRoom.participants);

// Server logs
grep "CensorshipAgent" server/logs/app.log | tail -20
```

---

## 📚 Additional Resources

- [HYBRID_ARCHITECTURE.md](./HYBRID_ARCHITECTURE.md) - Technical deep dive
- [CLAUDE.md](./CLAUDE.md) - AI assistant guide
- [Triton Setup](./runpod-service/triton/README.md) - TensorRT conversion
- [LiveKit Docs](https://docs.livekit.io) - Official documentation

---

## 🆘 Getting Help

1. Check [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)
2. Review server logs: `tail -f server/logs/app.log`
3. Check webhook diagnostics: `/webhook/diagnostics`
4. Open GitHub issue with logs and config

---

**Last Updated:** 2025-10-05
**Version:** 1.0.0 (Hybrid Pipeline)
