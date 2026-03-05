export const AVATAR_MAP = {
  default: '\u265A',
  pawn_w: '\u2659',
  pawn_b: '\u265F',
  knight_w: '\u2658',
  knight_b: '\u265E',
  bishop_w: '\u2657',
  bishop_b: '\u265D',
  rook_w: '\u2656',
  rook_b: '\u265C',
  queen_w: '\u2655',
  queen_b: '\u265B',
  king_w: '\u2654',
  king_b: '\u265A',
  flame: '\uD83D\uDD25',
  lightning: '\u26A1',
  crown: '\uD83D\uDC51',
};

export const AVATAR_OPTIONS = Object.keys(AVATAR_MAP);

export function getAvatar(avatarId) {
  return AVATAR_MAP[avatarId] || AVATAR_MAP.default;
}
