import { memo, useEffect, useState, useRef } from 'react';

// resultIcon: 'win' | 'loss' | 'draw' | null
const Timer = memo(({ timeMs, player, active, resultIcon, isPremium }) => {
  const [displayTime, setDisplayTime] = useState(timeMs);
  const baseRef = useRef(timeMs);
  const syncRef = useRef(Date.now());
  const activeRef = useRef(active);
  const timeMsRef = useRef(timeMs);

  // Keep timeMsRef current. Only snap refs/display when the timer is not actively
  // counting — avoids visible jumps from periodic server clock_update events.
  useEffect(() => {
    timeMsRef.current = timeMs;
    if (!activeRef.current) {
      baseRef.current = timeMs;
      syncRef.current = Date.now();
      setDisplayTime(timeMs);
    }
  }, [timeMs]);

  // Countdown interval — only recreated when active changes.
  useEffect(() => {
    activeRef.current = active;
    if (!active) {
      // Snap to authoritative server time when turn ends.
      baseRef.current = timeMsRef.current;
      syncRef.current = Date.now();
      setDisplayTime(timeMsRef.current);
      return;
    }
    // Always sync baseRef to the latest authoritative time when becoming active.
    // The timeMs effect may have run first with a stale activeRef, so we must
    // ensure baseRef reflects the current server time here.
    baseRef.current = timeMsRef.current;
    syncRef.current = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - syncRef.current;
      setDisplayTime(Math.max(0, baseRef.current - elapsed));
    }, 100);
    return () => clearInterval(interval);
  }, [active]);

  const isLowTime = displayTime < 30000;

  let timeDisplay;
  if (isLowTime) {
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

  const timeClass = isLowTime && !resultIcon
    ? 'timer-time-display timer-time-display--low'
    : 'timer-time-display';

  return (
    <div className={timerClass} style={{ margin: '6px 0' }}>
      <div className="timer-player-name" style={isPremium ? { color: '#ffd700', textShadow: '0 0 6px rgba(255,215,0,0.4)', fontWeight: 700 } : undefined}>
        {icon && <span className="timer-result-icon">{icon}</span>}
        {isPremium && '\u2605 '}{player}
      </div>
      <div className={timeClass}>
        {timeDisplay}
      </div>
    </div>
  );
});

Timer.displayName = 'Timer';

export default Timer;
