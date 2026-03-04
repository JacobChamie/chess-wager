import React, { useEffect, useState, useRef } from 'react';

const Timer = ({ timeMs, player, active, score = 0 }) => {
  const [displayTime, setDisplayTime] = useState(timeMs);
  const lastSyncRef = useRef(Date.now());

  // Sync from server
  useEffect(() => {
    setDisplayTime(timeMs);
    lastSyncRef.current = Date.now();
  }, [timeMs]);

  // Local interpolation for smooth countdown
  useEffect(() => {
    if (!active) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastSyncRef.current;
      const current = Math.max(0, timeMs - elapsed);
      setDisplayTime(current);
    }, 100);

    return () => clearInterval(interval);
  }, [active, timeMs]);

  const totalSeconds = Math.max(0, Math.ceil(displayTime / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    <div
      style={{
        margin: '8px 0',
        padding: '10px 16px',
        fontWeight: 'bold',
        color: '#f5f5f5',
        backgroundColor: active ? '#4caf50' : '#333',
        borderRadius: '10px',
        textAlign: 'center',
        fontSize: '16px',
        minWidth: '220px',
      }}
    >
      <div style={{ marginBottom: '4px' }}>
        {player} {score > 0 ? `· Score: ${score}` : ''}
      </div>
      <div>
        {minutes}:{seconds < 10 ? `0${seconds}` : seconds}
      </div>
    </div>
  );
};

export default Timer;
