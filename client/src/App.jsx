import { useState } from 'react';
import Broadcaster from './Broadcaster';
import Viewer from './Viewer';

function App() {
  const [mode, setMode] = useState(null); // null, 'broadcaster', or 'viewer'
  const [roomName, setRoomName] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [inputRoom, setInputRoom] = useState('');
  const [inputName, setInputName] = useState('');

  const handleJoinAsBroadcaster = () => {
    if (inputRoom && inputName) {
      setRoomName(inputRoom);
      setParticipantName(inputName);
      setMode('broadcaster');
    }
  };

  const handleJoinAsViewer = () => {
    if (inputRoom && inputName) {
      setRoomName(inputRoom);
      setParticipantName(inputName);
      setMode('viewer');
    }
  };

  const handleLeave = () => {
    setMode(null);
    setRoomName('');
    setParticipantName('');
  };

  if (mode === 'broadcaster') {
    return (
      <Broadcaster
        roomName={roomName}
        participantName={participantName}
        onLeave={handleLeave}
      />
    );
  }

  if (mode === 'viewer') {
    return (
      <Viewer
        roomName={roomName}
        participantName={participantName}
        onLeave={handleLeave}
      />
    );
  }

  return (
    <div className="home-container">
      <div>
        <h1 className="home-title">🎥 LiveKit Webinar</h1>
        <p className="home-subtitle">Professional live streaming made simple</p>
      </div>

      <div className="input-group">
        <input
          type="text"
          placeholder="Enter Room Name"
          value={inputRoom}
          onChange={(e) => setInputRoom(e.target.value)}
        />
        <input
          type="text"
          placeholder="Enter Your Name"
          value={inputName}
          onChange={(e) => setInputName(e.target.value)}
        />
      </div>

      <div className="button-group">
        <button
          className="broadcaster-btn"
          onClick={handleJoinAsBroadcaster}
          disabled={!inputRoom || !inputName}
        >
          📡 Start Broadcasting
        </button>
        <button
          className="viewer-btn"
          onClick={handleJoinAsViewer}
          disabled={!inputRoom || !inputName}
        >
          👁️ Watch Stream
        </button>
      </div>

      <div className="status">
        <h3>How it works</h3>
        <p>🎬 <strong>Broadcasters</strong> stream live video to thousands of viewers</p>
        <p>👥 <strong>Viewers</strong> watch in real-time with sub-100ms latency</p>
        <p>🚀 Powered by LiveKit WebRTC technology</p>
      </div>
    </div>
  );
}

export default App;
