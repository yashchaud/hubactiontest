"""
RunPod GPU Service - Real-Time Content Censorship
FastAPI server for processing video frames with ML models
"""

import os
import sys
import asyncio
import logging
from typing import List, Dict, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import numpy as np
import cv2
from dotenv import load_dotenv

# Import processors
from processors.text_detector import TextDetector
from processors.nsfw_detector import NSFWDetector
from processors.object_tracker import ObjectTracker
from processors.audio_profanity import AudioProfanityDetector
from processors.blur_applicator import BlurApplicator

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv('LOG_LEVEL', 'INFO')),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class ProcessingConfig(BaseModel):
    """Configuration for frame processing"""
    enable_text_detection: bool = True
    enable_nsfw_detection: bool = True
    enable_audio_profanity: bool = True
    enable_object_tracking: bool = True
    text_confidence: float = 0.7
    nsfw_confidence: float = 0.85
    audio_confidence: float = 0.8
    profanity_list: List[str] = []
    frame_sample_rate: int = 1


class DetectionResult(BaseModel):
    """Result from detection processing"""
    frame_id: int
    detections: List[Dict]
    processing_time_ms: float
    blur_mask: Optional[str] = None


class StreamSession:
    """Manages a streaming session with tracking state"""
    def __init__(self, session_id: str, config: ProcessingConfig):
        self.session_id = session_id
        self.config = config
        self.frame_count = 0
        self.trackers: Dict = {}
        logger.info(f"[Session {session_id}] Created new stream session")

    def should_process_frame(self) -> bool:
        """Determine if current frame should be processed based on sample rate"""
        return self.frame_count % self.config.frame_sample_rate == 0


# Global state
active_sessions: Dict[str, StreamSession] = {}
text_detector: Optional[TextDetector] = None
nsfw_detector: Optional[NSFWDetector] = None
audio_profanity_detector: Optional[AudioProfanityDetector] = None
object_tracker: Optional[ObjectTracker] = None
blur_applicator: Optional[BlurApplicator] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup ML models"""
    global text_detector, nsfw_detector, audio_profanity_detector, object_tracker, blur_applicator

    logger.info("Initializing ML models...")

    try:
        # Initialize processors
        text_detector = TextDetector()
        nsfw_detector = NSFWDetector()
        audio_profanity_detector = AudioProfanityDetector()
        object_tracker = ObjectTracker()
        blur_applicator = BlurApplicator()

        logger.info("All ML models loaded successfully")

        yield

        # Cleanup
        logger.info("Shutting down processors...")
        active_sessions.clear()

    except Exception as e:
        logger.error(f"Error during startup: {e}")
        raise


# Create FastAPI app
app = FastAPI(
    title="RunPod Content Censorship Service",
    description="Real-time video content censorship with ML models",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# HEALTH & INFO ENDPOINTS
# ============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "models_loaded": {
            "text_detector": text_detector is not None,
            "nsfw_detector": nsfw_detector is not None,
            "audio_profanity_detector": audio_profanity_detector is not None,
            "object_tracker": object_tracker is not None,
            "blur_applicator": blur_applicator is not None
        },
        "active_sessions": len(active_sessions)
    }


@app.get("/info")
async def service_info():
    """Get service information"""
    return {
        "service": "RunPod Content Censorship Service",
        "version": "1.0.0",
        "capabilities": [
            "Text detection and profanity filtering",
            "NSFW content detection",
            "Audio profanity detection",
            "Object tracking with motion prediction",
            "Dynamic blur application"
        ],
        "gpu_available": cv2.cuda.getCudaEnabledDeviceCount() > 0,
        "active_sessions": list(active_sessions.keys())
    }


# ============================================================================
# SESSION MANAGEMENT
# ============================================================================

@app.post("/session/create")
async def create_session(config: ProcessingConfig):
    """Create a new processing session"""
    import uuid
    session_id = str(uuid.uuid4())

    session = StreamSession(session_id, config)
    active_sessions[session_id] = session

    logger.info(f"Created session: {session_id}")

    return {
        "session_id": session_id,
        "config": config.dict()
    }


@app.delete("/session/{session_id}")
async def delete_session(session_id: str):
    """Delete a processing session"""
    if session_id in active_sessions:
        del active_sessions[session_id]
        logger.info(f"Deleted session: {session_id}")
        return {"status": "deleted", "session_id": session_id}

    raise HTTPException(status_code=404, detail="Session not found")


# ============================================================================
# FRAME PROCESSING ENDPOINTS
# ============================================================================

@app.post("/process/frame")
async def process_frame(
    session_id: str,
    frame_data: UploadFile = File(...)
):
    """Process a single video frame"""
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = active_sessions[session_id]
    session.frame_count += 1

    # Check if we should process this frame
    if not session.should_process_frame():
        return {
            "frame_id": session.frame_count,
            "skipped": True,
            "reason": "frame_sampling"
        }

    try:
        # Read frame data
        frame_bytes = await frame_data.read()
        nparr = np.frombuffer(frame_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            raise HTTPException(status_code=400, detail="Invalid frame data")

        # Process frame with all enabled detectors
        detections = []

        if session.config.enable_text_detection:
            text_results = await text_detector.detect(
                frame,
                session.config.text_confidence,
                session.config.profanity_list
            )
            detections.extend(text_results)

        if session.config.enable_nsfw_detection:
            nsfw_results = await nsfw_detector.detect(
                frame,
                session.config.nsfw_confidence
            )
            detections.extend(nsfw_results)

        # Update object trackers
        if session.config.enable_object_tracking:
            detections = await object_tracker.update_trackers(
                frame,
                detections,
                session.trackers
            )

        # Apply blur to detected regions
        blurred_frame = await blur_applicator.apply_blur(frame, detections)

        # Encode blurred frame
        _, buffer = cv2.imencode('.jpg', blurred_frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
        blurred_bytes = buffer.tobytes()

        return {
            "frame_id": session.frame_count,
            "detections": [d for d in detections],
            "detection_count": len(detections),
            "processing_time_ms": 0,  # Will be calculated by caller
            "has_blur": len(detections) > 0
        }

    except Exception as e:
        logger.error(f"Error processing frame: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# AUDIO PROCESSING ENDPOINT
# ============================================================================

@app.post("/process/audio")
async def process_audio(
    session_id: str,
    audio_data: UploadFile = File(...)
):
    """Process audio chunk for profanity detection"""
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = active_sessions[session_id]

    if not session.config.enable_audio_profanity:
        return {"profanity_detected": False, "timestamps": []}

    try:
        # Read audio data
        audio_bytes = await audio_data.read()

        # Process audio for profanity
        results = await audio_profanity_detector.detect(
            audio_bytes,
            session.config.audio_confidence,
            session.config.profanity_list
        )

        return {
            "profanity_detected": len(results) > 0,
            "detections": results,
            "count": len(results)
        }

    except Exception as e:
        logger.error(f"Error processing audio: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# WEBSOCKET ENDPOINT FOR REAL-TIME STREAMING
# ============================================================================

@app.websocket("/ws/stream/{session_id}")
async def websocket_stream(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for real-time frame streaming"""
    await websocket.accept()

    if session_id not in active_sessions:
        await websocket.send_json({"error": "Session not found"})
        await websocket.close()
        return

    session = active_sessions[session_id]
    logger.info(f"WebSocket connected for session: {session_id}")

    try:
        while True:
            # Receive frame data
            data = await websocket.receive_bytes()
            session.frame_count += 1

            # Check if we should process this frame
            if not session.should_process_frame():
                await websocket.send_json({
                    "frame_id": session.frame_count,
                    "skipped": True
                })
                continue

            # Decode frame
            nparr = np.frombuffer(data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if frame is None:
                await websocket.send_json({"error": "Invalid frame"})
                continue

            # Process frame (same logic as HTTP endpoint)
            detections = []

            if session.config.enable_text_detection:
                text_results = await text_detector.detect(
                    frame,
                    session.config.text_confidence,
                    session.config.profanity_list
                )
                detections.extend(text_results)

            if session.config.enable_nsfw_detection:
                nsfw_results = await nsfw_detector.detect(
                    frame,
                    session.config.nsfw_confidence
                )
                detections.extend(nsfw_results)

            if session.config.enable_object_tracking:
                detections = await object_tracker.update_trackers(
                    frame,
                    detections,
                    session.trackers
                )

            # Apply blur
            blurred_frame = await blur_applicator.apply_blur(frame, detections)

            # Encode and send
            _, buffer = cv2.imencode('.jpg', blurred_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])

            await websocket.send_json({
                "frame_id": session.frame_count,
                "detection_count": len(detections),
                "has_blur": len(detections) > 0
            })
            await websocket.send_bytes(buffer.tobytes())

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for session: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=os.getenv("SERVICE_HOST", "0.0.0.0"),
        port=int(os.getenv("SERVICE_PORT", 8000)),
        workers=int(os.getenv("WORKERS", 1))
    )
