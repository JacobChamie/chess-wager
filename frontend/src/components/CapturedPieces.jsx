import { memo, useMemo } from 'react';

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const PIECE_ORDER = ['q', 'r', 'b', 'n', 'p'];
const PIECE_UNICODE = {
  w: { k: '\u2654', q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658', p: '\u2659' },
  b: { k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' },
};

const STARTING_PIECES = { p: 8, n: 2, b: 2, r: 2, q: 1 };

function getCapturedPieces(fen) {
  if (!fen || fen === 'start') return { white: [], black: [], advantage: 0 };

  const board = fen.split(' ')[0];
  const counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };

  for (const ch of board) {
    if (ch === '/' || (ch >= '1' && ch <= '8')) continue;
    const color = ch === ch.toUpperCase() ? 'w' : 'b';
    const piece = ch.toLowerCase();
    if (counts[color][piece] !== undefined) counts[color][piece]++;
  }

  const whiteCaptured = [];
  const blackCaptured = [];
  let whiteMaterial = 0;
  let blackMaterial = 0;

  for (const piece of PIECE_ORDER) {
    const wMissing = STARTING_PIECES[piece] - counts.w[piece];
    const bMissing = STARTING_PIECES[piece] - counts.b[piece];
    for (let i = 0; i < wMissing; i++) blackCaptured.push(piece);
    for (let i = 0; i < bMissing; i++) whiteCaptured.push(piece);
    whiteMaterial += counts.w[piece] * PIECE_VALUES[piece];
    blackMaterial += counts.b[piece] * PIECE_VALUES[piece];
  }

  return {
    white: whiteCaptured,
    black: blackCaptured,
    advantage: whiteMaterial - blackMaterial,
  };
}

const CapturedPieces = memo(({ fen, color, flip }) => {
  const { white, black, advantage } = useMemo(() => getCapturedPieces(fen), [fen]);

  const pieces = color === 'w' ? white : black;
  const adv = color === 'w' ? advantage : -advantage;

  if (pieces.length === 0 && adv <= 0) return null;

  const capturedColor = color === 'w' ? 'b' : 'w';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      minHeight: '26px',
      padding: '2px 8px',
      fontSize: '16px',
      lineHeight: 1,
      direction: flip ? 'rtl' : 'ltr',
      borderRadius: '999px',
      background: pieces.length > 0 || adv > 0 ? 'rgba(255,255,255,0.05)' : 'transparent',
      border: pieces.length > 0 || adv > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none',
    }}>
      <span style={{ display: 'flex', gap: '1px', flexWrap: 'wrap', opacity: 0.95 }}>
        {pieces.map((p, i) => (
          <span key={i} style={{ fontSize: '15px' }}>
            {PIECE_UNICODE[capturedColor][p]}
          </span>
        ))}
      </span>
      {adv > 0 && (
        <span style={{
          fontSize: '12px',
          fontWeight: 800,
          color: '#9ccc65',
          marginLeft: '2px',
          fontVariantNumeric: 'tabular-nums',
        }}>
          +{adv}
        </span>
      )}
    </div>
  );
});

CapturedPieces.displayName = 'CapturedPieces';

export default CapturedPieces;
