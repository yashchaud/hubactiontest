#!/bin/bash
# Quick Test Script - Copy & Paste to Terminal
# Replace YOUR_RUNPOD_URL with your actual RunPod URL

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
RUNPOD_URL="http://YOUR_RUNPOD_URL:8000"
SERVER_URL="http://localhost:3001"
TEST_ROOM="test-room-001"

echo -e "${YELLOW}=== LiveKit Pipeline Testing ===${NC}\n"

# Test 1: RunPod Health
echo -e "${YELLOW}[Test 1] Checking RunPod health...${NC}"
HEALTH=$(curl -s ${RUNPOD_URL}/health)
if echo $HEALTH | grep -q "healthy"; then
    echo -e "${GREEN}✓ RunPod is healthy${NC}"
    echo $HEALTH | jq '.'
else
    echo -e "${RED}✗ RunPod health check failed${NC}"
    echo $HEALTH
fi
echo ""

# Test 2: Create Censorship Session
echo -e "${YELLOW}[Test 2] Creating censorship session...${NC}"
SESSION_RESPONSE=$(curl -s -X POST ${RUNPOD_URL}/session/create \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "nsfw_detection": true,
      "text_detection": true,
      "audio_profanity": false,
      "blur_strength": 25
    }
  }')

SESSION_ID=$(echo $SESSION_RESPONSE | jq -r '.session_id')
if [ "$SESSION_ID" != "null" ]; then
    echo -e "${GREEN}✓ Session created: $SESSION_ID${NC}"
    echo $SESSION_RESPONSE | jq '.'
else
    echo -e "${RED}✗ Session creation failed${NC}"
    echo $SESSION_RESPONSE
fi
echo ""

# Test 3: Generate Broadcaster Token
echo -e "${YELLOW}[Test 3] Generating broadcaster token...${NC}"
TOKEN_RESPONSE=$(curl -s -X POST ${SERVER_URL}/token \
  -H "Content-Type: application/json" \
  -d "{
    \"roomName\": \"${TEST_ROOM}\",
    \"participantName\": \"TestBroadcaster\",
    \"role\": \"broadcaster\"
  }")

TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.token')
if [ "$TOKEN" != "null" ] && [ -n "$TOKEN" ]; then
    echo -e "${GREEN}✓ Token generated${NC}"
    echo "Token: ${TOKEN:0:50}..."
    echo "WS URL: $(echo $TOKEN_RESPONSE | jq -r '.wsUrl')"
else
    echo -e "${RED}✗ Token generation failed${NC}"
    echo $TOKEN_RESPONSE
fi
echo ""

# Test 4: Start Stream
echo -e "${YELLOW}[Test 4] Starting stream with censorship...${NC}"
START_RESPONSE=$(curl -s -X POST ${SERVER_URL}/stream/start \
  -H "Content-Type: application/json" \
  -d "{
    \"roomName\": \"${TEST_ROOM}\",
    \"broadcasterIdentity\": \"TestBroadcaster-broadcaster\",
    \"censorshipConfig\": {
      \"nsfw_detection\": true,
      \"text_detection\": true,
      \"audio_profanity\": true,
      \"blur_strength\": 25
    }
  }")

if echo $START_RESPONSE | grep -q "success"; then
    echo -e "${GREEN}✓ Stream started${NC}"
    echo $START_RESPONSE | jq '.'
else
    echo -e "${RED}✗ Stream start failed${NC}"
    echo $START_RESPONSE
fi
echo ""

# Test 5: Check Stream Status
echo -e "${YELLOW}[Test 5] Checking stream status...${NC}"
STATUS_RESPONSE=$(curl -s ${SERVER_URL}/stream/status/${TEST_ROOM})
echo $STATUS_RESPONSE | jq '.'
echo ""

# Test 6: Process Test Frame (if test image exists)
if [ -f "test-data/test-image.jpg" ]; then
    echo -e "${YELLOW}[Test 6] Processing test frame...${NC}"
    FRAME_RESPONSE=$(curl -s -X POST ${RUNPOD_URL}/censorship/process-frame \
      -F "frame=@test-data/test-image.jpg" \
      -F "session_id=$SESSION_ID")

    echo $FRAME_RESPONSE | jq '.'
    echo ""
else
    echo -e "${YELLOW}[Test 6] Skipped - no test image found${NC}"
    echo "Create test-data/test-image.jpg to test frame processing"
    echo ""
fi

# Test 7: Check Active Streams
echo -e "${YELLOW}[Test 7] Listing active streams...${NC}"
ACTIVE_RESPONSE=$(curl -s ${SERVER_URL}/streams/active)
echo $ACTIVE_RESPONSE | jq '.'
echo ""

# Summary
echo -e "${YELLOW}=== Test Summary ===${NC}"
echo -e "Next steps:"
echo -e "1. Open browser to: http://localhost:3000"
echo -e "2. Select 'Broadcaster' mode"
echo -e "3. Enter room name: ${TEST_ROOM}"
echo -e "4. Join room and publish video"
echo -e "5. Check server logs for:"
echo -e "   ${GREEN}[FrameExtractor] Started egress${NC}"
echo -e "   ${GREEN}[ProcessingBridge] Track processing started${NC}"
echo ""
echo -e "To stop the stream:"
echo -e "curl -X POST ${SERVER_URL}/stream/end -H 'Content-Type: application/json' -d '{\"roomName\": \"${TEST_ROOM}\"}'"
echo ""
