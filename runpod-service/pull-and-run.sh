#!/bin/bash
# Easy script to pull pre-built images and run them
# Much faster than building locally!

set -e

# Configuration
DOCKER_USER="${DOCKER_USERNAME:-your-dockerhub-username}"
IMAGE_NAME="censorship-service"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}  Docker Image Pull & Run${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Show menu
echo "Select configuration:"
echo ""
echo "  1) Test image - Text + NSFW (1.3GB GPU) - RECOMMENDED for 2GB GPU"
echo "  2) Test image - Text Only (1GB GPU)"
echo "  3) Test image - NSFW Only (700MB GPU)"
echo "  4) Test image - All Features (CPU mode, no GPU)"
echo "  5) Production image - All Features (requires 24GB GPU)"
echo "  6) Pull all images (no run)"
echo ""
read -p "Enter choice [1-6]: " choice

case $choice in
    1)
        echo -e "${GREEN}Pulling test image...${NC}"
        docker pull ${DOCKER_USER}/${IMAGE_NAME}:test
        
        echo -e "${GREEN}Running Text + NSFW configuration...${NC}"
        docker run --rm --gpus all -p 8000:8000 \
          -e LOAD_TEXT_DETECTOR=true \
          -e LOAD_NSFW_DETECTOR=true \
          -e LOAD_AUDIO_DETECTOR=false \
          -e LOAD_OBJECT_TRACKER=true \
          ${DOCKER_USER}/${IMAGE_NAME}:test
        ;;
    
    2)
        echo -e "${GREEN}Pulling test image...${NC}"
        docker pull ${DOCKER_USER}/${IMAGE_NAME}:test
        
        echo -e "${GREEN}Running Text Only configuration...${NC}"
        docker run --rm --gpus all -p 8000:8000 \
          -e LOAD_TEXT_DETECTOR=true \
          -e LOAD_NSFW_DETECTOR=false \
          -e LOAD_AUDIO_DETECTOR=false \
          -e LOAD_OBJECT_TRACKER=true \
          ${DOCKER_USER}/${IMAGE_NAME}:test
        ;;
    
    3)
        echo -e "${GREEN}Pulling test image...${NC}"
        docker pull ${DOCKER_USER}/${IMAGE_NAME}:test
        
        echo -e "${GREEN}Running NSFW Only configuration...${NC}"
        docker run --rm --gpus all -p 8000:8000 \
          -e LOAD_TEXT_DETECTOR=false \
          -e LOAD_NSFW_DETECTOR=true \
          -e LOAD_AUDIO_DETECTOR=false \
          -e LOAD_OBJECT_TRACKER=true \
          ${DOCKER_USER}/${IMAGE_NAME}:test
        ;;
    
    4)
        echo -e "${GREEN}Pulling test image...${NC}"
        docker pull ${DOCKER_USER}/${IMAGE_NAME}:test
        
        echo -e "${GREEN}Running All Features (CPU mode)...${NC}"
        docker run --rm -p 8000:8000 \
          -e LOAD_TEXT_DETECTOR=true \
          -e LOAD_NSFW_DETECTOR=true \
          -e LOAD_AUDIO_DETECTOR=true \
          -e LOAD_OBJECT_TRACKER=true \
          ${DOCKER_USER}/${IMAGE_NAME}:test
        ;;
    
    5)
        echo -e "${GREEN}Pulling production image...${NC}"
        docker pull ${DOCKER_USER}/${IMAGE_NAME}:production
        
        echo -e "${YELLOW}Warning: This requires 24GB GPU (RunPod)${NC}"
        echo -e "${GREEN}Running Production configuration...${NC}"
        docker run --rm --gpus all -p 8000:8000 \
          ${DOCKER_USER}/${IMAGE_NAME}:production
        ;;
    
    6)
        echo -e "${GREEN}Pulling all images...${NC}"
        docker pull ${DOCKER_USER}/${IMAGE_NAME}:test
        docker pull ${DOCKER_USER}/${IMAGE_NAME}:production
        echo -e "${GREEN}All images pulled successfully!${NC}"
        echo ""
        echo "Run with:"
        echo "  docker run --rm --gpus all -p 8000:8000 ${DOCKER_USER}/${IMAGE_NAME}:test"
        ;;
    
    *)
        echo -e "${YELLOW}Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}To set your Docker username permanently:${NC}"
echo -e "${GREEN}export DOCKER_USERNAME=your-dockerhub-username${NC}"
echo -e "${GREEN}=========================================${NC}"
