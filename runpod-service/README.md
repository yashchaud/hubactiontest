# RunPod GPU Service - Content Censorship

Real-time video content censorship service using ML models on GPU.

## Features

- **Text Detection**: OCR-based profanity detection with Keras-OCR
- **NSFW Detection**: Nudity and inappropriate content detection with NudeNet
- **Object Tracking**: OpenCV CSRT/KCF trackers with motion prediction
- **Audio Profanity**: Whisper transcription + profanity filtering
- **Dynamic Blur**: Gaussian blur, pixelation, or black box censoring

## Quick Start

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Copy environment file
cp .env.example .env

# Run service
python main.py
```

### Docker Build

```bash
# Build image
docker build -t runpod-censorship:latest .

# Run container
docker run --gpus all -p 8000:8000 \
  -v $(pwd)/models:/app/models \
  runpod-censorship:latest
```

### RunPod Deployment

1. **Build and push Docker image**:
```bash
docker tag runpod-censorship:latest <your-registry>/runpod-censorship:latest
docker push <your-registry>/runpod-censorship:latest
```

2. **Deploy on RunPod**:
   - Go to RunPod.io
   - Create new pod with GPU (RTX 4090 recommended)
   - Use custom Docker image: `<your-registry>/runpod-censorship:latest`
   - Expose port 8000
   - Set environment variables

## API Endpoints

### Health Check
```
GET /health
```

### Create Session
```
POST /session/create
Body: {
  "enable_text_detection": true,
  "enable_nsfw_detection": true,
  "enable_audio_profanity": true,
  "enable_object_tracking": true,
  "text_confidence": 0.7,
  "nsfw_confidence": 0.85,
  "profanity_list": ["word1", "word2"]
}
```

### Process Frame (HTTP)
```
POST /process/frame?session_id=<session_id>
Body: (multipart/form-data) frame_data=<image_file>
```

### Process Frame (WebSocket)
```
WS /ws/stream/<session_id>
Send: Binary frame data
Receive: JSON detection result + Binary blurred frame
```

### Process Audio
```
POST /process/audio?session_id=<session_id>
Body: (multipart/form-data) audio_data=<audio_file>
```

## Configuration

Edit `.env` file:

```env
# Model confidence thresholds
TEXT_DETECTION_CONFIDENCE=0.7
NSFW_DETECTION_CONFIDENCE=0.85

# Processing settings
FRAME_SAMPLE_RATE=1  # Process every Nth frame
ENABLE_TEXT_DETECTION=true
ENABLE_NSFW_DETECTION=true

# Blur settings
BLUR_KERNEL_SIZE=51
BLUR_SIGMA=25

# Tracking settings
TRACKER_TYPE=CSRT  # CSRT, KCF, or MOSSE
PREDICTION_FRAMES=3
```

## Performance Tuning

### GPU Optimization

- **Frame sampling**: Set `FRAME_SAMPLE_RATE=3` to process every 3rd frame (10 FPS detection, 30 FPS output)
- **Model optimization**: Use TensorRT for 5-10x speedup
- **Batch processing**: Process multiple frames together

### Latency Reduction

- Use `TRACKER_TYPE=MOSSE` for faster tracking (less accurate)
- Reduce `PREDICTION_FRAMES` to 1 for lower latency
- Disable audio processing if not needed

### Memory Management

- Set `GPU_MEMORY_FRACTION=0.8` to limit GPU memory usage
- Use `MAX_CONCURRENT_STREAMS=5` to limit simultaneous sessions

## Model Downloads

Models are downloaded automatically on first run:

- **Keras-OCR**: ~300MB (text detection)
- **NudeNet**: ~120MB (NSFW detection)
- **Whisper** (optional): 140MB (base) to 3GB (large)

## Troubleshomarks

### Out of Memory

- Reduce `BLUR_KERNEL_SIZE`
- Lower `MAX_CONCURRENT_STREAMS`
- Use smaller Whisper model

### Slow Performance

- Enable GPU acceleration: Check `cv2.cuda.getCudaEnabledDeviceCount() > 0`
- Use TensorRT optimization
- Increase `FRAME_SAMPLE_RATE`

### Missing Models

- Check internet connection (models download on first run)
- Manually download models to `/app/models/`

## Integration with LiveKit Backend

See Node.js backend documentation for integration via `processingBridge.js`.

## License

MIT
