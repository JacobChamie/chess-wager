// src/components/timer.jsx
import React, { useEffect, useState } from 'react';

const Timer = ({ timeControl, player, active, onTimeout, score = 0 }) => {
  const [timeLeft, setTimeLeft] = useState(timeControl);

  // Reset timer when time control or game changes
  useEffect(() => {
    setTimeLeft(timeControl);
  }, [timeControl]);

  useEffect(() => {
    if (!active || timeLeft <= 0) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev > 1) return prev - 1;
        clearInterval(interval);
        onTimeout?.();
        return 0;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [active, timeLeft, onTimeout]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

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
        {player} · Score: {score}
      </div>
      <div>
        {minutes}:{seconds < 10 ? `0${seconds}` : seconds}
      </div>
    </div>
  );
};

export default Timer;
