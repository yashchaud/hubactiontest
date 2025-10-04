# Pull & Run Pre-Built Images (No Building!)

## Overview

GitHub Actions automatically builds TWO images for you:
- **`:test`** - For local testing on 2GB GPU (with feature toggles)
- **`:production`** - For RunPod deployment on 24GB GPU

**Pulling is MUCH faster than building locally!**

---

## Quick Start (3 Commands!)

### Step 1: Set Your Docker Username

```bash
export DOCKER_USERNAME=your-dockerhub-username
```

### Step 2: Pull & Run

```bash
cd runpod-service
./pull-and-run.sh
```

Select option 1 (Text + NSFW) - perfect for 2GB GPU!

### Step 3: Test

```bash
curl http://localhost:8000/health
./test-scripts/test-text-detection.sh
```

**Done!** No building required.

---

## Available Images

### 🧪 Test Image (`:test`)

**Purpose**: Local testing with feature toggles
**Dockerfile**: `Dockerfile.cpu-test`
**Size**: ~8GB
**GPU**: Works with 2GB+ or CPU

**Pull**:
```bash
docker pull your-username/censorship-service:test
```

**Configurations**:
1. Text + NSFW (1.3GB GPU) ✅ Recommended for 2GB
2. Text Only (1GB GPU)
3. NSFW Only (700MB GPU)
4. All Features (CPU, no GPU)

---

### 🏭 Production Image (`:production` / `:latest`)

**Purpose**: RunPod deployment
**Dockerfile**: `Dockerfile.optimized`
**Size**: ~8GB
**GPU**: Requires 24GB

**Pull**:
```bash
docker pull your-username/censorship-service:production
```

**Use for**: RunPod deployment with all features enabled

---

## Easy Methods to Run

### Method 1: Interactive Menu (Easiest!)

```bash
./pull-and-run.sh
```

Menu options:
1. Text + NSFW (2GB GPU) ← **Start here!**
2. Text Only (1GB GPU)
3. NSFW Only (700MB GPU)  
4. All Features (CPU)
5. Production (24GB GPU)
6. Pull all images

---

### Method 2: Quick Switcher

```bash
# Text + NSFW (2GB GPU)
./switch-config.sh test-text-nsfw

# All Features (CPU)
./switch-config.sh test-cpu

# Production (24GB GPU)
./switch-config.sh production
```

---

### Method 3: Manual Commands

#### Text + NSFW (2GB GPU) - RECOMMENDED

```bash
docker pull your-username/censorship-service:test

docker run --rm --gpus all -p 8000:8000 \
  -e LOAD_TEXT_DETECTOR=true \
  -e LOAD_NSFW_DETECTOR=true \
  -e LOAD_AUDIO_DETECTOR=false \
  -e LOAD_OBJECT_TRACKER=true \
  your-username/censorship-service:test
```

#### CPU Mode (All Features)

```bash
docker pull your-username/censorship-service:test

docker run --rm -p 8000:8000 \
  -e LOAD_TEXT_DETECTOR=true \
  -e LOAD_NSFW_DETECTOR=true \
  -e LOAD_AUDIO_DETECTOR=true \
  -e LOAD_OBJECT_TRACKER=true \
  your-username/censorship-service:test
```

#### Production (RunPod)

```bash
docker pull your-username/censorship-service:production

docker run --rm --gpus all -p 8000:8000 \
  your-username/censorship-service:production
```

---

## GitHub Actions Workflow

### Automatic Builds

On every push to `main` or `develop`:
```
✅ Builds :test image (Dockerfile.cpu-test)
✅ Builds :production image (Dockerfile.optimized)
✅ Pushes to DockerHub
```

Tags created:
- `your-username/censorship-service:test`
- `your-username/censorship-service:production`
- `your-username/censorship-service:latest` (same as production)

### Manual Trigger

Go to GitHub Actions → "Build and Push Docker Images" → Run workflow

Options:
- **all** - Build both test and production
- **test** - Build only test image
- **production** - Build only production image

---

## Image Comparison

| Feature | Test Image | Production Image |
|---------|------------|------------------|
| **Dockerfile** | Dockerfile.cpu-test | Dockerfile.optimized |
| **Tag** | `:test` | `:production` / `:latest` |
| **GPU Required** | 2GB+ or CPU | 24GB |
| **Feature Toggle** | ✅ Yes (env vars) | ✅ Yes (all on by default) |
| **Use Case** | Local testing | RunPod deployment |
| **Build Time** | ~10 min | ~15 min |
| **Size** | ~8GB | ~8GB |

---

## Switching Between Configs

### Switch from Local Test to Production

```bash
# Stop current container (Ctrl+C)

# Switch to production
./switch-config.sh production
```

### Switch Test Configurations

```bash
# Stop current (Ctrl+C)

# Run different test config
docker run --rm --gpus all -p 8000:8000 \
  -e LOAD_TEXT_DETECTOR=false \
  -e LOAD_NSFW_DETECTOR=true \  # Changed!
  -e LOAD_AUDIO_DETECTOR=false \
  your-username/censorship-service:test
```

---

## Pull Speed Comparison

| Method | Time | When to Use |
|--------|------|-------------|
| **Pull from DockerHub** | **2-5 min** | ✅ **Always use this!** |
| Build locally | 15-30 min | Only for development |

**Pulling is 5-10x faster!**

---

## Testing Workflow

### Day 1: Pull & Test Text + NSFW

```bash
# Pull pre-built image (2-5 min)
docker pull your-username/censorship-service:test

# Run Text + NSFW
./switch-config.sh test-text-nsfw

# Test features
curl http://localhost:8000/health
./test-scripts/test-text-detection.sh
./test-scripts/test-nsfw-detection.sh
```

### Day 2: Test Different Config

```bash
# Same image, different env vars (instant!)
docker run --rm --gpus all -p 8000:8000 \
  -e LOAD_TEXT_DETECTOR=false \
  -e LOAD_NSFW_DETECTOR=true \
  -e LOAD_AUDIO_DETECTOR=false \
  your-username/censorship-service:test
```

### Day 3: Deploy to RunPod

```bash
# Pull production image
docker pull your-username/censorship-service:production

# Test locally (if you have 24GB GPU)
docker run --rm --gpus all -p 8000:8000 \
  your-username/censorship-service:production

# Deploy to RunPod
# Image: your-username/censorship-service:production
```

---

## Troubleshooting

### Image Not Found

**Error**: `manifest for your-username/censorship-service:test not found`

**Solution**:
1. Check GitHub Actions completed successfully
2. Verify DockerHub secrets are set:
   - `DOCKERHUB_USERNAME`
   - `DOCKERHUB_TOKEN`
3. Update `your-username` to actual DockerHub username

---

### Pull is Slow

**Expected**: First pull takes 2-5 minutes (8GB image)
**Subsequent pulls**: Only download changed layers (~1 min)

**Speed up**:
```bash
# Use nearest DockerHub mirror
export DOCKER_REGISTRY_MIRROR=https://mirror.gcr.io
```

---

### Wrong Configuration Running

**Check what's loaded**:
```bash
curl http://localhost:8000/health | python -m json.tool
```

Look at `models_loaded`:
```json
{
  "models_loaded": {
    "text_detector": true,     // ✅ or ❌
    "nsfw_detector": true,      // ✅ or ❌
    "audio_profanity_detector": false
  }
}
```

---

## Summary

### For Your 2GB GPU:

**Best Method**:
```bash
export DOCKER_USERNAME=your-dockerhub-username
cd runpod-service
./pull-and-run.sh
# Select option 1 (Text + NSFW)
```

**Benefits**:
- ✅ No building (2-5 min vs 15-30 min)
- ✅ Pre-tested images from CI/CD
- ✅ Easy switching between configs
- ✅ Same image, different env vars
- ✅ Always up-to-date with latest code

**Images Available**:
- `your-username/censorship-service:test` - For 2GB GPU testing
- `your-username/censorship-service:production` - For RunPod

**Start pulling now!** 🚀
