#!/bin/bash
# Run with Text + NSFW Detection (Fits in 2GB GPU!)
# GPU Memory: ~1.3GB

echo "========================================="
echo "Starting Service: Text + NSFW Detection"
echo "GPU Memory Required: ~1.3GB"
echo "Port: 8000"
echo "========================================="
echo ""

docker run --rm --gpus all -p 8000:8000 \
  -e LOAD_TEXT_DETECTOR=true \
  -e LOAD_NSFW_DETECTOR=true \
  -e LOAD_AUDIO_DETECTOR=false \
  -e LOAD_OBJECT_TRACKER=true \
  -e LOG_LEVEL=INFO \
  censorship:cpu-test

echo ""
echo "Service stopped."
