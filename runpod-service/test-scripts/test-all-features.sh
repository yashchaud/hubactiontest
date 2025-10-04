#!/bin/bash
# Test All Features Together (CPU Mode)

set -e

SERVER_URL="${1:-http://localhost:8000}"

echo "========================================="
echo "Testing ALL Features (CPU Mode)"
echo "========================================="
echo ""

echo "[1/4] Checking service health..."
HEALTH=$(curl -s "$SERVER_URL/health")
echo "$HEALTH" | python3 -m json.tool
echo ""

echo "[2/4] Creating session (all features enabled)..."
SESSION_RESPONSE=$(curl -s -X POST "$SERVER_URL/session/create" \
  -H "Content-Type: application/json" \
  -d '{
    "enable_text_detection": true,
    "enable_nsfw_detection": true,
    "enable_audio_profanity": true,
    "enable_object_tracking": true,
    "text_confidence": 0.7,
    "nsfw_confidence": 0.85,
    "audio_confidence": 0.8,
    "profanity_list": ["badword", "profanity"]
  }')

echo "$SESSION_RESPONSE" | python3 -m json.tool
SESSION_ID=$(echo "$SESSION_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['session_id'])")
echo "Session ID: $SESSION_ID"
echo ""

echo "[3/4] Processing test frame (this may take 2-4 seconds on CPU)..."
START_TIME=$(date +%s%N)

if [ -f "test-data/test-image.jpg" ]; then
    RESPONSE=$(curl -s -X POST "$SERVER_URL/process/frame?session_id=$SESSION_ID" \
      -F "frame_data=@test-data/test-image.jpg")
    
    END_TIME=$(date +%s%N)
    DURATION=$(( (END_TIME - START_TIME) / 1000000 ))
    
    echo "$RESPONSE" | python3 -m json.tool
    echo ""
    echo "⏱️  Processing time: ${DURATION}ms"
else
    echo "❌ Error: test-data/test-image.jpg not found"
    exit 1
fi
echo ""

echo "[4/4] Cleaning up session..."
curl -s -X DELETE "$SERVER_URL/session/$SESSION_ID"
echo ""

echo "========================================="
echo "✅ All Features Test Complete!"
echo "Expected CPU time: 2000-4000ms"
echo "Expected GPU time: 200-400ms (on RunPod)"
echo "========================================="
