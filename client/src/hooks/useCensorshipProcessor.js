import { useEffect, useRef, useState, useCallback } from 'react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

/**
 * Hook to capture and process video frames for censorship detection
 * @param {Object} videoTrackRef - Reference to LiveKit video track
 * @param {string} roomName - Room name for session tracking
 * @param {boolean} enabled - Whether censorship is enabled
 * @returns {Object} Detection state and controls
 */
export function useCensorshipProcessor(videoTrackRef, roomName, enabled) {
  const [detections, setDetections] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState({
    framesProcessed: 0,
    detectionsFound: 0,
    lastProcessedAt: null
  });

  const canvasRef = useRef(null);
  const processingInterval = useRef(null);
  const sessionId = useRef(null);

  /**
   * Capture frame from video track and convert to blob
   */
  const captureFrame = useCallback(async () => {
    if (!videoTrackRef || !videoTrackRef.videoTrack) {
      return null;
    }

    try {
      // Get video element from track
      const videoElement = videoTrackRef.videoTrack.attach();

      // Create canvas if not exists
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      // Set canvas size to match video
      canvas.width = videoElement.videoWidth || 640;
      canvas.height = videoElement.videoHeight || 480;

      // Draw current frame
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

      // Convert to blob
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          videoElement.remove(); // Clean up
          resolve(blob);
        }, 'image/jpeg', 0.8);
      });
    } catch (error) {
      console.error('[CensorshipProcessor] Error capturing frame:', error);
      return null;
    }
  }, [videoTrackRef]);

  /**
   * Send frame to backend for processing
   */
  const processFrame = useCallback(async (frameBlob) => {
    if (!frameBlob || !sessionId.current) {
      return null;
    }

    try {
      const formData = new FormData();
      formData.append('frame', frameBlob, 'frame.jpg');
      formData.append('session_id', sessionId.current);
      formData.append('room_name', roomName);

      const response = await fetch(`${SERVER_URL}/censorship/process-frame`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Processing failed: ${response.statusText}`);
      }

      const result = await response.json();

      // Update stats
      setStats(prev => ({
        framesProcessed: prev.framesProcessed + 1,
        detectionsFound: prev.detectionsFound + (result.detection_count || 0),
        lastProcessedAt: new Date()
      }));

      // Update detections if any found
      if (result.detections && result.detections.length > 0) {
        setDetections(prev => [
          ...result.detections.map(d => ({
            ...d,
            timestamp: new Date()
          })),
          ...prev.slice(0, 9) // Keep last 10 detections
        ]);
      }

      return result;
    } catch (error) {
      console.error('[CensorshipProcessor] Error processing frame:', error);
      return null;
    }
  }, [roomName]);

  /**
   * Main processing loop
   */
  const startProcessing = useCallback(async () => {
    if (!enabled || !videoTrackRef) {
      return;
    }

    setIsProcessing(true);

    // Create censorship session
    try {
      const response = await fetch(`${SERVER_URL}/censorship/create-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_name: roomName,
          enable_text_detection: true,
          enable_nsfw_detection: true,
          enable_audio_profanity: false // Audio handled separately
        })
      });

      if (response.ok) {
        const data = await response.json();
        sessionId.current = data.session_id;
        console.log('[CensorshipProcessor] Session created:', sessionId.current);
      }
    } catch (error) {
      console.error('[CensorshipProcessor] Failed to create session:', error);
      setIsProcessing(false);
      return;
    }

    // Start frame capture loop (process 1 frame per second)
    processingInterval.current = setInterval(async () => {
      const frameBlob = await captureFrame();
      if (frameBlob) {
        await processFrame(frameBlob);
      }
    }, 1000); // 1 FPS

  }, [enabled, videoTrackRef, roomName, captureFrame, processFrame]);

  /**
   * Stop processing and cleanup
   */
  const stopProcessing = useCallback(async () => {
    if (processingInterval.current) {
      clearInterval(processingInterval.current);
      processingInterval.current = null;
    }

    // Delete session
    if (sessionId.current) {
      try {
        await fetch(`${SERVER_URL}/censorship/delete-session/${sessionId.current}`, {
          method: 'DELETE'
        });
        console.log('[CensorshipProcessor] Session deleted:', sessionId.current);
      } catch (error) {
        console.error('[CensorshipProcessor] Failed to delete session:', error);
      }
      sessionId.current = null;
    }

    setIsProcessing(false);
    setDetections([]);
  }, []);

  /**
   * Auto-start/stop based on enabled state
   */
  useEffect(() => {
    if (enabled && videoTrackRef && !isProcessing) {
      startProcessing();
    } else if (!enabled && isProcessing) {
      stopProcessing();
    }

    return () => {
      stopProcessing();
    };
  }, [enabled, videoTrackRef, isProcessing, startProcessing, stopProcessing]);

  return {
    detections,
    isProcessing,
    stats,
    clearDetections: () => setDetections([])
  };
}
