# Testing on 2GB GPU - Quick Guide

## TL;DR

Your 2GB GPU cannot run all AI models together (needs 2GB+). Use CPU testing instead.

## Quick Start

```bash
cd runpod-service

# 1. Build CPU test image
docker build -f Dockerfile.cpu-test -t censorship:cpu-test .

# 2. Create test data folder
mkdir -p test-data
# Add test-image.jpg to test-data/

# 3. Run on CPU (no GPU needed)
docker run --rm -p 8000:8000 censorship:cpu-test

# 4. Wait 2-3 minutes for models to download

# 5. Test features
./test-scripts/test-text-detection.sh
./test-scripts/test-nsfw-detection.sh
./test-scripts/test-all-features.sh
```

## GPU Memory Breakdown

| Feature | Memory | Fits in 2GB? |
|---------|--------|--------------|
| Text Detection | 800MB | ✅ Alone |
| NSFW Detection | 500MB | ✅ Alone |
| Audio Whisper | 400MB | ✅ Alone |
| **All Together** | 2GB+ | ❌ No |

## Performance Expectations

| Mode | Latency | Use Case |
|------|---------|----------|
| CPU (2GB GPU) | 2-4s/frame | ✅ Local testing |
| GPU (24GB RunPod) | 0.2-0.4s/frame | ✅ Production |

## What You Can Test Locally

✅ **All features work on CPU** - slower but functional
✅ **Verify detections** - OCR, NSFW, tracking all work
✅ **Test blur application** - See processed frames
✅ **Session management** - Create/delete sessions
✅ **API endpoints** - All routes functional

## Test Scripts

```bash
# Test text detection (profanity OCR)
./test-scripts/test-text-detection.sh

# Test NSFW detection
./test-scripts/test-nsfw-detection.sh

# Test all features (CPU - takes 2-4s)
./test-scripts/test-all-features.sh
```

## Next Steps

1. ✅ Test locally on CPU (verify functionality)
2. ✅ Push to DockerHub (Dockerfile.optimized)
3. ✅ Deploy to RunPod (get 24GB GPU)
4. ✅ Test on GPU (verify performance)

See `RUNPOD_DEPLOYMENT.md` for RunPod setup.
