import { useEffect, useRef, useCallback } from 'react';

/**
 * Tracks behavioral signals during an active game:
 * - Tab switches (visibilitychange)
 * - Focus losses (window blur)
 * - Copy/paste events
 * - Mouse position sampling for entropy calculation
 *
 * Only tracks when the user is a player (not spectator) and the game is active.
 */
export function useBehaviorTracking(gameId, isActive, isSpectator) {
  const dataRef = useRef({
    tabSwitches: 0,
    focusLosses: 0,
    copyEvents: 0,
    pasteEvents: 0,
    mousePositions: [],
    tabSwitchTimestamps: [],
  });

  const mouseIntervalRef = useRef(null);
  const lastMousePosRef = useRef({ x: 0, y: 0 });

  // Track mouse position
  useEffect(() => {
    const onMouseMove = (e) => {
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);

  useEffect(() => {
    // Only track for active players
    if (!gameId || !isActive || isSpectator) return;

    // Reset data for new game
    dataRef.current = {
      tabSwitches: 0,
      focusLosses: 0,
      copyEvents: 0,
      pasteEvents: 0,
      mousePositions: [],
      tabSwitchTimestamps: [],
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        dataRef.current.tabSwitches++;
        dataRef.current.tabSwitchTimestamps.push(Date.now());
      }
    };

    const onBlur = () => {
      dataRef.current.focusLosses++;
    };

    const onCopy = () => {
      dataRef.current.copyEvents++;
    };

    const onPaste = () => {
      dataRef.current.pasteEvents++;
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);

    // Sample mouse position every 2 seconds
    mouseIntervalRef.current = setInterval(() => {
      dataRef.current.mousePositions.push({ ...lastMousePosRef.current });
      // Keep max 300 samples (~10 min game)
      if (dataRef.current.mousePositions.length > 300) {
        dataRef.current.mousePositions.shift();
      }
    }, 2000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      if (mouseIntervalRef.current) {
        clearInterval(mouseIntervalRef.current);
        mouseIntervalRef.current = null;
      }
    };
  }, [gameId, isActive, isSpectator]);

  const getBehaviorData = useCallback(() => {
    return { ...dataRef.current };
  }, []);

  return getBehaviorData;
}
