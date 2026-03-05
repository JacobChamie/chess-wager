import { memo, useEffect, useState, useRef } from 'react';

// resultIcon: 'win' | 'loss' | 'draw' | null
const Timer = memo(({ timeMs, player, active, resultIcon }) => {
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

  let timerClass;
  if (resultIcon === 'win') {
    timerClass = 'timer timer--win';
  } else if (resultIcon === 'loss') {
    timerClass = 'timer timer--loss';
  } else if (resultIcon === 'draw') {
    timerClass = 'timer timer--draw';
  } else if (active) {
    timerClass = isLowTime ? 'timer timer--low' : 'timer timer--active';
  } else {
    timerClass = 'timer timer--inactive';
  }

  const iconMap = { win: '\u{1F451}', loss: '\u2717', draw: '\u00BD' };
  const icon = resultIcon ? iconMap[resultIcon] : null;

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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '5px',
        }}
      >
        {icon && <span style={{ fontSize: '14px' }}>{icon}</span>}
        {player}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: isLowTime && !resultIcon ? '24px' : '20px',
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
