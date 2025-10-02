@echo off
REM Quick Test Script for Windows - Copy & Paste to Command Prompt
REM Replace YOUR_RUNPOD_URL with your actual RunPod URL

setlocal enabledelayedexpansion

set RUNPOD_URL=https://nf5m9pr3tyfmly-8000.proxy.runpod.net
set SERVER_URL=http://localhost:3001
set TEST_ROOM=test-room-001

echo === LiveKit Pipeline Testing ===
echo.

REM Test 1: RunPod Health
echo [Test 1] Checking RunPod health...
curl -s %RUNPOD_URL%/health
echo.
echo.

REM Test 2: Create Censorship Session
echo [Test 2] Creating censorship session...
curl -s -X POST %RUNPOD_URL%/session/create -H "Content-Type: application/json" -d "{\"config\": {\"nsfw_detection\": true, \"text_detection\": true, \"audio_profanity\": false, \"blur_strength\": 25}}"
echo.
echo.

REM Test 3: Generate Broadcaster Token
echo [Test 3] Generating broadcaster token...
curl -s -X POST %SERVER_URL%/token -H "Content-Type: application/json" -d "{\"roomName\": \"%TEST_ROOM%\", \"participantName\": \"TestBroadcaster\", \"role\": \"broadcaster\"}"
echo.
echo.

REM Test 4: Start Stream
echo [Test 4] Starting stream with censorship...
curl -s -X POST %SERVER_URL%/stream/start -H "Content-Type: application/json" -d "{\"roomName\": \"%TEST_ROOM%\", \"broadcasterIdentity\": \"TestBroadcaster-broadcaster\", \"censorshipConfig\": {\"nsfw_detection\": true, \"text_detection\": true, \"audio_profanity\": true, \"blur_strength\": 25}}"
echo.
echo.

REM Test 5: Check Stream Status
echo [Test 5] Checking stream status...
curl -s %SERVER_URL%/stream/status/%TEST_ROOM%
echo.
echo.

REM Test 6: Check Active Streams
echo [Test 6] Listing active streams...
curl -s %SERVER_URL%/streams/active
echo.
echo.

echo === Test Complete ===
echo Next steps:
echo 1. Open browser to: http://localhost:3000
echo 2. Select 'Broadcaster' mode
echo 3. Enter room name: %TEST_ROOM%
echo 4. Join room and publish video
echo 5. Check server logs for frame extraction
echo.
echo To stop the stream:
echo curl -X POST %SERVER_URL%/stream/end -H "Content-Type: application/json" -d "{\"roomName\": \"%TEST_ROOM%\"}"
echo.

pause
