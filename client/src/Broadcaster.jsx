import { useState, useEffect } from 'react';
import {
  LiveKitRoom,
  VideoTrack,
  useTracks,
  useLocalParticipant,
  useParticipants,
  ControlBar,
  RoomAudioRenderer,
  useMediaDeviceSelect
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import '@livekit/components-styles';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// Broadcaster stream component with professional controls
function BroadcasterStream() {
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

  const screenShareTrack = tracks.find(
    track => track.source === Track.Source.ScreenShare
  );

  return (
    <div className="broadcaster-layout">
      <RoomAudioRenderer />

      {/* Broadcast Info Header */}
      <div className="broadcaster-header">
        <div className="broadcast-info">
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
            role: 'broadcaster'
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to get token');
        }

        const data = await response.json();
        console.log('Token received:', data.token ? 'Yes' : 'No');
        console.log('WebSocket URL:', data.wsUrl);
        setToken(data.token);
        setWsUrl(data.wsUrl);
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
          <h2>Preparing your broadcast...</h2>
          <p>Please wait while we set up your stream</p>
        </div>
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
          <BroadcasterStream />
        </LiveKitRoom>
      </div>
    </div>
  );
}
