#!/bin/bash
# Test Text Detection Feature

set -e

SERVER_URL="${1:-http://localhost:8000}"

echo "========================================="
echo "Testing Text Detection Feature"
echo "========================================="
echo ""

# 1. Health check
echo "[1/4] Checking service health..."
curl -s "$SERVER_URL/health" | python3 -m json.tool
echo ""

# 2. Create session with text detection only
echo "[2/4] Creating session (text detection enabled)..."
SESSION_RESPONSE=$(curl -s -X POST "$SERVER_URL/session/create" \
  -H "Content-Type: application/json" \
  -d '{
    "enable_text_detection": true,
    "enable_nsfw_detection": false,
    "enable_audio_profanity": false,
    "enable_object_tracking": true,
    "text_confidence": 0.7,
    "profanity_list": ["badword", "profanity", "nsfw"]
  }')

echo "$SESSION_RESPONSE" | python3 -m json.tool
SESSION_ID=$(echo "$SESSION_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['session_id'])")
echo ""
echo "Session ID: $SESSION_ID"
echo ""

# 3. Process test frame
echo "[3/4] Processing test frame..."
if [ -f "test-data/test-image.jpg" ]; then
    echo "Using test-data/test-image.jpg"
    RESPONSE=$(curl -s -X POST "$SERVER_URL/process/frame?session_id=$SESSION_ID" \
      -F "frame_data=@test-data/test-image.jpg")
    echo "$RESPONSE" | python3 -m json.tool
else
    echo "❌ Error: test-data/test-image.jpg not found"
    echo "   Create test-data directory and add test images"
    exit 1
fi
echo ""

# 4. Cleanup
echo "[4/4] Cleaning up session..."
curl -s -X DELETE "$SERVER_URL/session/$SESSION_ID"
echo ""

echo "========================================="
echo "✅ Text Detection Test Complete!"
echo "========================================="
