#!/bin/bash
# Quick configuration switcher
# Switch between test and production images easily

DOCKER_USER="${DOCKER_USERNAME:-your-dockerhub-username}"
IMAGE_NAME="censorship-service"

# Parse arguments
if [ "$1" == "test-text-nsfw" ]; then
    echo "Switching to: Test - Text + NSFW (2GB GPU)"
    docker pull ${DOCKER_USER}/${IMAGE_NAME}:test
    docker run --rm --gpus all -p 8000:8000 \
      -e LOAD_TEXT_DETECTOR=true \
      -e LOAD_NSFW_DETECTOR=true \
      -e LOAD_AUDIO_DETECTOR=false \
      ${DOCKER_USER}/${IMAGE_NAME}:test

elif [ "$1" == "test-cpu" ]; then
    echo "Switching to: Test - All Features (CPU)"
    docker pull ${DOCKER_USER}/${IMAGE_NAME}:test
    docker run --rm -p 8000:8000 \
      -e LOAD_TEXT_DETECTOR=true \
      -e LOAD_NSFW_DETECTOR=true \
      -e LOAD_AUDIO_DETECTOR=true \
      ${DOCKER_USER}/${IMAGE_NAME}:test

elif [ "$1" == "production" ]; then
    echo "Switching to: Production (24GB GPU)"
    docker pull ${DOCKER_USER}/${IMAGE_NAME}:production
    docker run --rm --gpus all -p 8000:8000 \
      ${DOCKER_USER}/${IMAGE_NAME}:production

else
    echo "Usage: $0 {test-text-nsfw|test-cpu|production}"
    echo ""
    echo "Options:"
    echo "  test-text-nsfw  - Test image with Text + NSFW (2GB GPU)"
    echo "  test-cpu        - Test image with all features (CPU)"
    echo "  production      - Production image (24GB GPU)"
    echo ""
    echo "Example:"
    echo "  $0 test-text-nsfw"
    exit 1
fi
