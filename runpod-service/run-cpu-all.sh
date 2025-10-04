#!/bin/bash
# Run ALL features on CPU (No GPU needed)

echo "========================================="
echo "Starting Service: ALL Features (CPU)"
echo "GPU Memory Required: 0GB (CPU only)"
echo "Port: 8000"
echo "Note: Slower but tests everything"
echo "========================================="
echo ""

docker run --rm -p 8000:8000 \
  -e LOAD_TEXT_DETECTOR=true \
  -e LOAD_NSFW_DETECTOR=true \
  -e LOAD_AUDIO_DETECTOR=true \
  -e LOAD_OBJECT_TRACKER=true \
  -e LOG_LEVEL=INFO \
  censorship:cpu-test

echo ""
echo "Service stopped."
