import { useState, useEffect, useRef } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useTracks,
  useParticipants,
  useRoomContext
} from '@livekit/components-react';
import { Track, RoomEvent } from 'livekit-client';
import '@livekit/components-styles';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// Cinema-mode viewer component for watching livestreams
function ViewerStream() {
  const room = useRoomContext();
  const [censoredFrame, setCensoredFrame] = useState(null);
  const [censorshipActive, setCensorshipActive] = useState(false);
  const canvasRef = useRef(null);

  const tracks = useTracks(
    [Track.Source.Camera, Track.Source.ScreenShare],
    { onlySubscribed: false }
  );

  const participants = useParticipants();

  // Listen for censored frames from agent via data channel
  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload, participant) => {
      try {
        const decoder = new TextDecoder();
        const message = JSON.stringify(decoder.decode(payload));
        const data = JSON.parse(message);

        if (data.type === 'censored_frame') {
          setCensoredFrame(data.frame);
          setCensorshipActive(true);
          console.log(`[Viewer] Received censored frame #${data.frameNumber}`);
        }
      } catch (error) {
        console.error('[Viewer] Error processing data:', error);
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room]);

  // Filter out local participant to get viewer count
  const viewerCount = participants.length;

  return (
    <div className="viewer-layout">
      <RoomAudioRenderer />

      {tracks.length === 0 ? (
        <div className="waiting-container">
          <div className="spinner"></div>
          <h2>Waiting for broadcast to start...</h2>
          <p>The stream will appear here once the broadcaster goes live</p>
          <p style={{ marginTop: '20px', color: '#667eea', fontWeight: 600 }}>
            👥 {viewerCount} {viewerCount === 1 ? 'person' : 'people'} waiting
          </p>
        </div>
      ) : (
        <div className="cinema-video-container">
          <div className="video-overlay">
            <div className="live-badge">
              <div className="live-indicator"></div>
              LIVE
            </div>
            <div className="viewer-count">
              <span className="viewer-count-icon">👁️</span>
              <span>{viewerCount}</span>
            </div>
          </div>

          {/* Cinema-mode video player */}
          <div style={{
            position: 'relative',
            width: '100%',
            paddingTop: '56.25%', // 16:9 aspect ratio
            background: '#000'
          }}>
            {censorshipActive && censoredFrame ? (
              // Show censored frame when available
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%'
              }}>
                <img
                  src={`data:image/jpeg;base64,${censoredFrame}`}
                  alt="Censored Stream"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain'
                  }}
                />
                {/* AI censorship indicator */}
                <div style={{
                  position: 'absolute',
                  top: '10px',
                  right: '10px',
                  background: 'rgba(239, 68, 68, 0.9)',
                  color: 'white',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <div style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#fff',
                    animation: 'pulse 2s infinite'
                  }}></div>
                  AI CENSORED
                </div>
              </div>
            ) : (
              // Show original stream when no censorship
              tracks.map((trackRef) => (
                <div
                  key={trackRef.publication.trackSid}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%'
                  }}
                >
                  <VideoTrack
                    trackRef={trackRef}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain'
                    }}
                  />
                </div>
              ))
            )}
          </div>

          {/* Broadcaster name overlay */}
          {tracks.length > 0 && (
            <div style={{
              position: 'absolute',
              bottom: '20px',
              left: '20px',
              background: 'rgba(0, 0, 0, 0.8)',
              color: 'white',
              padding: '10px 16px',
              borderRadius: '10px',
              fontSize: '16px',
              fontWeight: 600,
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              🎬 {tracks[0].participant.identity.split('-')[0]}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Viewer({ roomName, participantName, onLeave }) {
  const [token, setToken] = useState('');
  const [wsUrl, setWsUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function getToken() {
      try {
        setLoading(true);

        const response = await fetch(`${SERVER_URL}/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            roomName,
            participantName,
            role: 'viewer'
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to get token');
        }

        const data = await response.json();
        setToken(data.token);
        setWsUrl(data.wsUrl);

        console.log(`[Viewer] Connected to room: ${roomName}`);
      } catch (err) {
        console.error('Error fetching token:', err);
        setError('Failed to connect to server. Make sure the backend is running.');
      } finally {
        setLoading(false);
      }
    }

    getToken();
  }, [roomName, participantName]);

  if (error) {
    return (
      <div className="container">
        <button className="back-btn" onClick={onLeave}>← Back to Home</button>
        <div className="status error">
          <h2>⚠️ Connection Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (loading || !token || !wsUrl) {
    return (
      <div className="container">
        <div className="waiting-container">
          <div className="spinner"></div>
          <h2>Connecting to stream...</h2>
          <p>Please wait while we connect you to the webinar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="viewer-header">
        <button className="back-btn" onClick={onLeave}>← Leave Stream</button>
        <h1 className="stream-title">📺 {roomName}</h1>
        <div style={{ width: '140px' }}></div> {/* Spacer for centering */}
      </div>

      <div className="video-container">
        <LiveKitRoom
          video={false}
          audio={false}
          token={token}
          serverUrl={wsUrl}
          connect={true}
          onDisconnected={onLeave}
          onError={(error) => {
            console.error('LiveKit connection error:', error);
            setError(`Connection failed: ${error.message}`);
          }}
        >
          <ViewerStream />
        </LiveKitRoom>
      </div>
    </div>
  );
}
