import { useState, useEffect, useRef } from 'react';
import {
  LiveKitRoom,
  VideoTrack,
  useTracks,
  useLocalParticipant,
  useParticipants,
  ControlBar,
  RoomAudioRenderer,
  useRoomContext
} from '@livekit/components-react';
import { Track, RoomEvent } from 'livekit-client';
import '@livekit/components-styles';
import { useCensorshipProcessor } from './hooks/useCensorshipProcessor';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// Broadcaster stream component with professional controls
function BroadcasterStream({ censorshipEnabled, roomName }) {
  const room = useRoomContext();
  const tracks = useTracks(
    [Track.Source.Camera, Track.Source.ScreenShare],
    { onlySubscribed: false }
  );

  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();

  // Calculate viewer count (total participants minus broadcaster)
  const viewerCount = Math.max(0, participants.length - 1);

  // Find local video track
  const localVideoTrack = tracks.find(
    track => track.participant.identity === localParticipant.identity &&
            track.source === Track.Source.Camera
  );

  // Use censorship processor hook (for UI display only - frames are processed server-side)
  const { detections, isProcessing, stats } = useCensorshipProcessor(
    localVideoTrack,
    roomName,
    censorshipEnabled
  );

  const screenShareTrack = tracks.find(
    track => track.source === Track.Source.ScreenShare
  );

  return (
    <div className="broadcaster-layout">
      <RoomAudioRenderer />

      {/* Broadcast Info Header */}
      <div className="broadcaster-header">
        <div className="broadcast-info" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div className="live-badge">
            <div className="live-indicator"></div>
            LIVE
          </div>
          <div className="viewer-count">
            <span className="viewer-count-icon">👁️</span>
            <span>{viewerCount}</span>
            <span style={{ fontSize: '14px', marginLeft: '4px' }}>
              {viewerCount === 1 ? 'viewer' : 'viewers'}
            </span>
          </div>
          {censorshipEnabled && (
            <div style={{
              background: 'rgba(102, 126, 234, 0.2)',
              border: '1px solid rgba(102, 126, 234, 0.5)',
              color: '#667eea',
              padding: '8px 16px',
              borderRadius: '20px',
              fontSize: '14px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: isProcessing ? '#10b981' : '#667eea',
                animation: isProcessing ? 'pulse 2s infinite' : 'none'
              }}></span>
              🤖 AI Agent {isProcessing ? 'Processing' : 'Active'}
            </div>
          )}
        </div>
      </div>

      {/* Video Preview */}
      <div style={{
        position: 'relative',
        width: '100%',
        paddingTop: '56.25%', // 16:9 aspect ratio
        background: '#000',
        borderRadius: '12px',
        overflow: 'hidden'
      }}>
        {/* Screen Share (if active, takes priority) */}
        {screenShareTrack ? (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%'
          }}>
            <VideoTrack
              trackRef={screenShareTrack}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain'
              }}
            />
            {/* Picture-in-picture for camera when screen sharing */}
            {localVideoTrack && (
              <div style={{
                position: 'absolute',
                bottom: '20px',
                right: '20px',
                width: '240px',
                height: '135px',
                borderRadius: '12px',
                overflow: 'hidden',
                border: '2px solid rgba(255, 255, 255, 0.3)',
                background: '#000'
              }}>
                <VideoTrack
                  trackRef={localVideoTrack}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }}
                />
              </div>
            )}
          </div>
        ) : localVideoTrack ? (
          /* Camera only */
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%'
          }}>
            <VideoTrack
              trackRef={localVideoTrack}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain'
              }}
            />
          </div>
        ) : (
          /* No video */
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>📹</div>
              <h3>Camera Off</h3>
              <p style={{ color: '#a0a0b0' }}>Enable your camera to start broadcasting</p>
            </div>
          </div>
        )}

        {/* Broadcaster name badge */}
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
          🎬 You (Broadcasting)
        </div>
      </div>

      {/* Control Bar */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.8)',
        borderRadius: '12px',
        padding: '10px',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        <ControlBar
          variation="verbose"
          controls={{
            microphone: true,
            camera: true,
            screenShare: true,
            leave: false,
            chat: false,
            settings: false
          }}
        />
      </div>

      {/* Censorship Detection Panel */}
      {censorshipEnabled && isProcessing && (
        <div style={{
          background: 'rgba(0, 0, 0, 0.8)',
          border: '1px solid rgba(102, 126, 234, 0.5)',
          borderRadius: '12px',
          padding: '16px',
          marginTop: '10px'
        }}>
          <div style={{ marginBottom: '12px' }}>
            <h3 style={{ margin: 0, marginBottom: '8px', color: '#667eea', fontSize: '16px' }}>
              🛡️ Censorship Monitor
            </h3>
            <div style={{ display: 'flex', gap: '20px', fontSize: '13px', color: '#a0a0b0' }}>
              <span>Frames: {stats.framesProcessed}</span>
              <span>Detections: {stats.detectionsFound}</span>
              {stats.lastProcessedAt && (
                <span>Last: {stats.lastProcessedAt.toLocaleTimeString()}</span>
              )}
            </div>
          </div>

          {/* Recent Detections */}
          {detections.length > 0 && (
            <div style={{
              maxHeight: '120px',
              overflowY: 'auto',
              background: 'rgba(255, 0, 0, 0.1)',
              borderRadius: '8px',
              padding: '8px'
            }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#ff6b6b', marginBottom: '6px' }}>
                ⚠️ Recent Detections:
              </div>
              {detections.slice(0, 5).map((detection, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '6px 8px',
                    background: 'rgba(255, 107, 107, 0.2)',
                    borderRadius: '6px',
                    marginBottom: '4px',
                    fontSize: '12px',
                    color: '#ffb3b3'
                  }}
                >
                  <strong>{detection.type}:</strong> {detection.description || 'Detected'}
                  {detection.confidence && ` (${Math.round(detection.confidence * 100)}%)`}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Broadcast Tips */}
      <div style={{
        background: 'rgba(102, 126, 234, 0.1)',
        border: '1px solid rgba(102, 126, 234, 0.3)',
        borderRadius: '12px',
        padding: '16px',
        marginTop: '10px'
      }}>
        <p style={{ fontSize: '14px', color: '#a0a0b0', margin: 0 }}>
          💡 <strong>Tip:</strong> {viewerCount === 0
            ? 'Share your room link to let viewers join your broadcast'
            : `${viewerCount} ${viewerCount === 1 ? 'person is' : 'people are'} watching your stream`}
        </p>
      </div>
    </div>
  );
}

export default function Broadcaster({ roomName, participantName, onLeave }) {
  const [token, setToken] = useState('');
  const [wsUrl, setWsUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [enableCensorship, setEnableCensorship] = useState(true);
  const [censorshipActive, setCensorshipActive] = useState(false);

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

  // Show censorship toggle before connecting
  if (!token || !wsUrl) {
    return (
      <div className="container">
        <button className="back-btn" onClick={onLeave}>← Back to Home</button>

        {loading ? (
          <div className="waiting-container">
            <div className="spinner"></div>
            <h2>Preparing your broadcast...</h2>
            <p>Please wait while we set up your stream</p>
          </div>
        ) : (
          <div style={{ maxWidth: '600px', margin: '40px auto', textAlign: 'center' }}>
            <h2>🎬 Start Broadcasting</h2>
            <p style={{ color: '#a0a0b0', marginBottom: '30px' }}>
              Configure your stream settings before going live
            </p>

            {/* Censorship Toggle */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.4)',
              borderRadius: '12px',
              padding: '24px',
              marginBottom: '20px',
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ textAlign: 'left', flex: 1 }}>
                  <h3 style={{ margin: 0, marginBottom: '8px' }}>🛡️ Content Censorship</h3>
                  <p style={{ margin: 0, fontSize: '14px', color: '#a0a0b0' }}>
                    Automatically detect and blur inappropriate content, profanity, and sensitive text in real-time
                  </p>
                </div>
                <label style={{
                  position: 'relative',
                  display: 'inline-block',
                  width: '60px',
                  height: '34px',
                  marginLeft: '20px'
                }}>
                  <input
                    type="checkbox"
                    checked={enableCensorship}
                    onChange={(e) => setEnableCensorship(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    cursor: 'pointer',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: enableCensorship ? '#667eea' : '#555',
                    transition: '0.4s',
                    borderRadius: '34px'
                  }}>
                    <span style={{
                      position: 'absolute',
                      content: '""',
                      height: '26px',
                      width: '26px',
                      left: enableCensorship ? '30px' : '4px',
                      bottom: '4px',
                      backgroundColor: 'white',
                      transition: '0.4s',
                      borderRadius: '50%'
                    }}></span>
                  </span>
                </label>
              </div>

              {enableCensorship && (
                <div style={{
                  marginTop: '16px',
                  padding: '12px',
                  background: 'rgba(102, 126, 234, 0.1)',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: '#a0a0b0',
                  textAlign: 'left'
                }}>
                  ✅ Will detect: NSFW content, profanity, sensitive text (phone numbers, emails, SSNs)
                </div>
              )}
            </div>

            <button
              onClick={async () => {
                try {
                  setLoading(true);
                  setError('');

                  // Start stream with censorship preference
                  const streamResponse = await fetch(`${SERVER_URL}/stream/start`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      roomName,
                      broadcasterName: participantName,
                      options: {
                        enableCensorship
                      }
                    }),
                  });

                  if (!streamResponse.ok) {
                    throw new Error('Failed to start stream');
                  }

                  const streamData = await streamResponse.json();
                  setCensorshipActive(streamData.censorship?.enabled || false);
                  console.log('Stream started:', streamData);

                  // Get access token
                  const tokenResponse = await fetch(`${SERVER_URL}/token`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      roomName,
                      participantName,
                      role: 'broadcaster'
                    }),
                  });

                  if (!tokenResponse.ok) {
                    throw new Error('Failed to get token');
                  }

                  const tokenData = await tokenResponse.json();
                  setToken(tokenData.token);
                  setWsUrl(tokenData.wsUrl);
                } catch (err) {
                  console.error('Error:', err);
                  setError(err.message);
                } finally {
                  setLoading(false);
                }
              }}
              style={{
                padding: '16px 32px',
                fontSize: '18px',
                fontWeight: 600,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                width: '100%'
              }}
            >
              Start Broadcast
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container">
      <div className="broadcaster-header">
        <button className="back-btn" onClick={onLeave}>← Leave Broadcast</button>
        <h1 style={{ textAlign: 'center', flex: 1 }}>📡 Broadcasting: {roomName}</h1>
        <button className="end-stream-btn" onClick={onLeave}>
          End Stream
        </button>
      </div>

      <div className="video-container">
        <LiveKitRoom
          video={true}
          audio={true}
          token={token}
          serverUrl={wsUrl}
          connect={true}
          onDisconnected={onLeave}
          onError={(error) => {
            console.error('LiveKit connection error:', error);
            setError(`Connection failed: ${error.message}`);
          }}
        >
          <BroadcasterStream censorshipEnabled={censorshipActive} roomName={roomName} />
        </LiveKitRoom>
      </div>
    </div>
  );
}
