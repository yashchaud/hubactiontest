#!/bin/bash

# ==============================================================================
# Optimized Docker Build Script
# ==============================================================================
#
# This script builds the Docker image with optimal caching and performance
#
# Usage:
#   ./docker-build.sh              # Build with default tag
#   ./docker-build.sh my-tag       # Build with custom tag
#   ./docker-build.sh --no-cache   # Force rebuild without cache
#
# ==============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="censorship-service"
DEFAULT_TAG="optimized"
DOCKERFILE="Dockerfile.optimized"

# Parse arguments
TAG="${1:-$DEFAULT_TAG}"
NO_CACHE=""

if [ "$1" == "--no-cache" ]; then
    NO_CACHE="--no-cache"
    TAG="${2:-$DEFAULT_TAG}"
fi

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  Optimized Docker Build for RunPod Service${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running${NC}"
    exit 1
fi

# Check if Dockerfile exists
if [ ! -f "$DOCKERFILE" ]; then
    echo -e "${RED}Error: $DOCKERFILE not found${NC}"
    exit 1
fi

# Show build configuration
echo -e "${YELLOW}Build Configuration:${NC}"
echo -e "  Image: ${GREEN}${IMAGE_NAME}:${TAG}${NC}"
echo -e "  Dockerfile: ${GREEN}${DOCKERFILE}${NC}"
echo -e "  Cache: ${GREEN}$([ -z "$NO_CACHE" ] && echo "Enabled" || echo "Disabled")${NC}"
echo ""

# Check .dockerignore
if [ ! -f ".dockerignore" ]; then
    echo -e "${YELLOW}Warning: .dockerignore not found (build may be slower)${NC}"
else
    IGNORED_COUNT=$(wc -l < .dockerignore)
    echo -e "${GREEN}✓ .dockerignore found (${IGNORED_COUNT} patterns)${NC}"
fi

echo ""
echo -e "${BLUE}Starting build...${NC}"
echo ""

# Record start time
START_TIME=$(date +%s)

# Build with BuildKit for better caching
DOCKER_BUILDKIT=1 docker build \
    -f "$DOCKERFILE" \
    -t "${IMAGE_NAME}:${TAG}" \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    $NO_CACHE \
    . 2>&1 | tee build.log

# Record end time
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  Build Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "  Image: ${GREEN}${IMAGE_NAME}:${TAG}${NC}"
echo -e "  Time: ${GREEN}${MINUTES}m ${SECONDS}s${NC}"

# Show image size
IMAGE_SIZE=$(docker images "${IMAGE_NAME}:${TAG}" --format "{{.Size}}")
echo -e "  Size: ${GREEN}${IMAGE_SIZE}${NC}"

echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo ""
echo -e "  1. Test the image locally:"
echo -e "     ${BLUE}docker run --rm --gpus all -p 8000:8000 ${IMAGE_NAME}:${TAG}${NC}"
echo ""
echo -e "  2. Tag for DockerHub:"
echo -e "     ${BLUE}docker tag ${IMAGE_NAME}:${TAG} YOUR_USERNAME/${IMAGE_NAME}:${TAG}${NC}"
echo ""
echo -e "  3. Push to DockerHub:"
echo -e "     ${BLUE}docker push YOUR_USERNAME/${IMAGE_NAME}:${TAG}${NC}"
echo ""
echo -e "  4. Deploy to RunPod:"
echo -e "     ${BLUE}Use YOUR_USERNAME/${IMAGE_NAME}:${TAG} as the container image${NC}"
echo ""

# Save build info
cat > build-info.txt <<EOF
Build completed: $(date)
Image: ${IMAGE_NAME}:${TAG}
Duration: ${MINUTES}m ${SECONDS}s
Size: ${IMAGE_SIZE}
Dockerfile: ${DOCKERFILE}
EOF

echo -e "${GREEN}Build info saved to build-info.txt${NC}"
echo ""
