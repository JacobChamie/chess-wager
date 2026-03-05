import { memo, useEffect, useState, useRef } from 'react';

const Timer = memo(({ timeMs, player, active }) => {
  const [displayTime, setDisplayTime] = useState(timeMs);
  const lastSyncRef = useRef(Date.now());

  useEffect(() => {
    setDisplayTime(timeMs);
    lastSyncRef.current = Date.now();
  }, [timeMs]);

  const isLowTime = displayTime < 30000;

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastSyncRef.current;
      const current = Math.max(0, timeMs - elapsed);
      setDisplayTime(current);
    }, isLowTime ? 50 : 100);
    return () => clearInterval(interval);
  }, [active, timeMs, isLowTime]);

  let timeDisplay;
  if (displayTime < 30000) {
    const totalTenths = Math.max(0, Math.floor(displayTime / 100));
    const secs = Math.floor(totalTenths / 10);
    const tenths = totalTenths % 10;
    timeDisplay = `${secs}.${tenths}`;
  } else {
    const totalSeconds = Math.max(0, Math.ceil(displayTime / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    timeDisplay = `${minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;
  }

  const timerClass = active
    ? isLowTime
      ? 'timer timer--low'
      : 'timer timer--active'
    : 'timer timer--inactive';

  return (
    <div className={timerClass} style={{ margin: '6px 0' }}>
      <div
        style={{
          fontSize: '12px',
          fontWeight: 600,
          opacity: 0.8,
          marginBottom: '2px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {player}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: isLowTime ? '24px' : '20px',
          fontWeight: 700,
          lineHeight: 1.2,
        }}
      >
        {timeDisplay}
      </div>
    </div>
  );
});

Timer.displayName = 'Timer';

export default Timer;
