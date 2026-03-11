import { useEffect, useRef } from 'react';

function createBadgeFavicon(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  // Draw chess piece icon
  ctx.font = '24px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u265A', 16, 16);

  // Badge dot
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(26, 6, 6, 0, Math.PI * 2);
  ctx.fill();

  return canvas.toDataURL();
}

export function useGameTabTitle(gameState) {
  const originalTitle = useRef(document.title);
  const originalFavicon = useRef(null);

  useEffect(() => {
    // Capture original favicon
    const link = document.querySelector("link[rel~='icon']");
    if (link && !originalFavicon.current) {
      originalFavicon.current = link.href;
    }
  }, []);

  const status = gameState?.status;
  const isMyTurn = gameState?.isMyTurn;
  const isSpectator = gameState?.isSpectator;

  useEffect(() => {
    if (!status) return;

    const savedTitle = originalTitle.current;
    const savedFavicon = originalFavicon.current;

    if (status === 'active') {
      if (isSpectator) {
        document.title = 'Spectating - ELO Stakes';
      } else if (isMyTurn) {
        document.title = 'Your turn - ELO Stakes';
      } else {
        document.title = 'Waiting... - ELO Stakes';
      }

      // Update favicon with badge
      const badgeColor = isMyTurn ? '#7cb342' : '#ffa726';
      const faviconUrl = createBadgeFavicon(badgeColor);
      let link = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = faviconUrl;
    } else if (status === 'completed') {
      document.title = 'Game Over - ELO Stakes';
    }

    return () => {
      document.title = savedTitle;
      const link = document.querySelector("link[rel~='icon']");
      if (link && savedFavicon) {
        link.href = savedFavicon;
      }
    };
  }, [status, isMyTurn, isSpectator]);
}
