export const BOT_PERSONALITIES = [
  {
    id: 'beginner',
    name: 'Woody',
    title: 'The Beginner',
    description: 'Just learning the pieces',
    rating: 800,
    stockfish: { uciElo: 1320, moveTimeMs: 200, randomBlunderPct: 40 },
    thinkTime: { min: 500, max: 2000 },
  },
  {
    id: 'easy',
    name: 'Chip',
    title: 'The Casual',
    description: 'Knows the basics, makes mistakes',
    rating: 1100,
    stockfish: { uciElo: 1320, moveTimeMs: 300, randomBlunderPct: 15 },
    thinkTime: { min: 800, max: 3000 },
  },
  {
    id: 'medium',
    name: 'Sierra',
    title: 'The Club Player',
    description: 'Solid fundamentals, tactical awareness',
    rating: 1400,
    stockfish: { uciElo: 1400, moveTimeMs: 500 },
    thinkTime: { min: 1000, max: 4000 },
  },
  {
    id: 'hard',
    name: 'Magnus Jr.',
    title: 'The Competitor',
    description: 'Strong positional play, few blunders',
    rating: 1800,
    stockfish: { uciElo: 1800, moveTimeMs: 800 },
    thinkTime: { min: 1500, max: 5000 },
  },
  {
    id: 'expert',
    name: 'Athena',
    title: 'The Expert',
    description: 'Near-master level, very dangerous',
    rating: 2200,
    stockfish: { uciElo: 2200, moveTimeMs: 1200 },
    thinkTime: { min: 2000, max: 6000 },
  },
  {
    id: 'master',
    name: 'Deep Mind',
    title: 'The Grandmaster',
    description: 'Maximum strength, no mercy',
    rating: 3000,
    stockfish: { uciElo: 3190, moveTimeMs: 2000 },
    thinkTime: { min: 2500, max: 8000 },
  },
];

export function getPersonality(id) {
  return BOT_PERSONALITIES.find((p) => p.id === id) || null;
}
