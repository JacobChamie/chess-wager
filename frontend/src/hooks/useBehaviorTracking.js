import { useEffect, useRef, useCallback } from 'react';

/**
 * Generates a stable canvas fingerprint for this browser/GPU combination.
 * Different hardware/drivers produce slightly different pixel output, making
 * this a reliable signal for identifying the same physical machine across accounts.
 */
function generateCanvasFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Draw a reproducible scene whose pixel output varies by GPU/driver
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f0f';
    ctx.fillRect(0, 0, 240, 60);
    ctx.fillStyle = 'rgba(0,200,100,0.8)';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillText('ChessWager\u00A9\u2665', 8, 24);
    ctx.fillStyle = '#069';
    ctx.font = '12px Georgia, serif';
    ctx.fillText('fp:' + navigator.hardwareConcurrency, 8, 44);
    ctx.strokeStyle = 'rgba(255,128,0,0.5)';
    ctx.beginPath();
    ctx.arc(200, 30, 20, 0, Math.PI * 2);
    ctx.stroke();

    const dataUrl = canvas.toDataURL('image/png');

    // djb2 hash of the data URL → deterministic hex fingerprint
    let hash = 5381;
    for (let i = 0; i < dataUrl.length; i++) {
      hash = Math.imul((hash << 5) + hash, 1) + dataUrl.charCodeAt(i);
      hash |= 0; // Convert to 32-bit int
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  } catch {
    return null;
  }
}

/**
 * Tracks behavioral signals during an active game:
 * - Tab switches (visibilitychange)
 * - Focus losses (window blur)
 * - Copy/paste events
 * - Mouse position sampling for entropy calculation
 * - DOM mutations on the chess board (external script injection detection)
 * - Simulated (untrusted) click events (bot/automation detection)
 * - Canvas fingerprint for environment/machine identification
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
    mutationEvents: 0,
    simulatedClicks: 0,
    canvasFingerprint: null,
  });

  const mouseIntervalRef = useRef(null);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const mutationObserverRef = useRef(null);

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

    // Reset data for new game and generate canvas fingerprint
    dataRef.current = {
      tabSwitches: 0,
      focusLosses: 0,
      copyEvents: 0,
      pasteEvents: 0,
      mousePositions: [],
      tabSwitchTimestamps: [],
      mutationEvents: 0,
      simulatedClicks: 0,
      canvasFingerprint: generateCanvasFingerprint(),
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

    // Detect simulated (programmatic) click events — real user clicks have isTrusted = true.
    // Bots/automation using element.click() or dispatchEvent produce isTrusted = false.
    const onPointerDown = (e) => {
      if (!e.isTrusted) {
        dataRef.current.simulatedClicks++;
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('pointerdown', onPointerDown, { capture: true });

    // DOM MutationObserver: watch the chess board for unexpected external mutations.
    // Legitimate play never adds new child elements to the board mid-game via external code.
    // Engine overlay tools and board-reading scripts often inject elements or change attributes.
    const boardEl = document.getElementById('main-board');
    if (boardEl) {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          // Flag added nodes that are NOT from our own React reconciler.
          // React-managed mutations happen synchronously during renders; external scripts
          // typically add nodes asynchronously after the board is settled.
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
              // Ignore text nodes and our own component elements (they have React fiber keys)
              if (node.nodeType === Node.ELEMENT_NODE && !node._reactFiber && !node.__reactFiber) {
                dataRef.current.mutationEvents++;
              }
            }
          }
          // Attribute mutations on the board container itself (not piece moves)
          if (mutation.type === 'attributes' && mutation.target === boardEl) {
            dataRef.current.mutationEvents++;
          }
        }
      });

      observer.observe(boardEl, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-fen', 'data-engine', 'data-eval'],
      });

      mutationObserverRef.current = observer;
    }

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
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });

      if (mutationObserverRef.current) {
        mutationObserverRef.current.disconnect();
        mutationObserverRef.current = null;
      }

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
