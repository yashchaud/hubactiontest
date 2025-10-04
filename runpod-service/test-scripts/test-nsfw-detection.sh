#!/bin/bash
# Test NSFW Detection Feature

set -e

SERVER_URL="${1:-http://localhost:8000}"

echo "========================================="
echo "Testing NSFW Detection Feature"
echo "========================================="
echo ""

echo "[1/4] Checking service health..."
curl -s "$SERVER_URL/health" | python3 -m json.tool
echo ""

echo "[2/4] Creating session (NSFW detection enabled)..."
SESSION_RESPONSE=$(curl -s -X POST "$SERVER_URL/session/create" \
  -H "Content-Type: application/json" \
  -d '{
    "enable_text_detection": false,
    "enable_nsfw_detection": true,
    "enable_audio_profanity": false,
    "enable_object_tracking": true,
    "nsfw_confidence": 0.85
  }')

echo "$SESSION_RESPONSE" | python3 -m json.tool
SESSION_ID=$(echo "$SESSION_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['session_id'])")
echo "Session ID: $SESSION_ID"
echo ""

echo "[3/4] Processing test frame..."
if [ -f "test-data/test-image.jpg" ]; then
    RESPONSE=$(curl -s -X POST "$SERVER_URL/process/frame?session_id=$SESSION_ID" \
      -F "frame_data=@test-data/test-image.jpg")
    echo "$RESPONSE" | python3 -m json.tool
else
    echo "❌ Error: test-data/test-image.jpg not found"
    exit 1
fi
echo ""

echo "[4/4] Cleaning up session..."
curl -s -X DELETE "$SERVER_URL/session/$SESSION_ID"
echo ""

echo "========================================="
echo "✅ NSFW Detection Test Complete!"
echo "========================================="
