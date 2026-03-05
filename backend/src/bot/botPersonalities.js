export const BOT_PERSONALITIES = [
  {
    id: 'beginner',
    name: 'Woody',
    title: 'The Beginner',
    description: 'Just learning the pieces',
    rating: 400,
    stockfish: { skillLevel: 0, depth: 1, moveTimeMs: 200 },
    thinkTime: { min: 500, max: 2000 },
  },
  {
    id: 'easy',
    name: 'Chip',
    title: 'The Casual',
    description: 'Knows the basics, makes mistakes',
    rating: 800,
    stockfish: { skillLevel: 3, depth: 4, moveTimeMs: 300 },
    thinkTime: { min: 800, max: 3000 },
  },
  {
    id: 'medium',
    name: 'Sierra',
    title: 'The Club Player',
    description: 'Solid fundamentals, tactical awareness',
    rating: 1200,
    stockfish: { skillLevel: 8, depth: 8, moveTimeMs: 500 },
    thinkTime: { min: 1000, max: 4000 },
  },
  {
    id: 'hard',
    name: 'Magnus Jr.',
    title: 'The Competitor',
    description: 'Strong positional play, few blunders',
    rating: 1600,
    stockfish: { skillLevel: 13, depth: 12, moveTimeMs: 800 },
    thinkTime: { min: 1500, max: 5000 },
  },
  {
    id: 'expert',
    name: 'Athena',
    title: 'The Expert',
    description: 'Near-master level, very dangerous',
    rating: 2000,
    stockfish: { skillLevel: 17, depth: 16, moveTimeMs: 1200 },
    thinkTime: { min: 2000, max: 6000 },
  },
  {
    id: 'master',
    name: 'Deep Mind',
    title: 'The Grandmaster',
    description: 'Maximum strength, no mercy',
    rating: 2500,
    stockfish: { skillLevel: 20, depth: 20, moveTimeMs: 2000 },
    thinkTime: { min: 2500, max: 8000 },
  },
];

export function getPersonality(id) {
  return BOT_PERSONALITIES.find((p) => p.id === id) || null;
}
