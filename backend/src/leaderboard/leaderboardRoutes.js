import { Router } from 'express';
import { pool } from '../config/db.js';

const router = Router();

// GET /api/leaderboard — Top 50 players by rating
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id, u.username, u.rating, u.avatar_id, u.created_at,
        COUNT(g.id) FILTER (WHERE g.result IS NOT NULL) AS games,
        COUNT(g.id) FILTER (WHERE
          (g.white_user_id = u.id AND g.result = '1-0') OR
          (g.black_user_id = u.id AND g.result = '0-1')
        ) AS wins,
        COUNT(g.id) FILTER (WHERE
          (g.white_user_id = u.id AND g.result = '0-1') OR
          (g.black_user_id = u.id AND g.result = '1-0')
        ) AS losses,
        COUNT(g.id) FILTER (WHERE g.result = '1/2-1/2') AS draws
      FROM users u
      LEFT JOIN games g ON (g.white_user_id = u.id OR g.black_user_id = u.id)
        AND g.status = 'completed' AND (g.is_bot_game IS NOT TRUE)
      GROUP BY u.id
      ORDER BY u.rating DESC
      LIMIT 50
    `);

    const players = result.rows.map((r, i) => ({
      rank: i + 1,
      id: r.id,
      username: r.username,
      rating: r.rating,
      avatarId: r.avatar_id,
      games: Number(r.games),
      wins: Number(r.wins),
      losses: Number(r.losses),
      draws: Number(r.draws),
      winRate: Number(r.games) > 0
        ? Math.round((Number(r.wins) / Number(r.games)) * 100)
        : 0,
    }));

    res.json({ players });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// GET /api/leaderboard/players/:username — Player profile
router.get('/players/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const userResult = await pool.query(
      'SELECT id, username, email, rating, avatar_id, created_at FROM users WHERE username = $1',
      [username]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Player not found' });

    const statsResult = await pool.query(`
      SELECT
        COUNT(g.id) FILTER (WHERE g.result IS NOT NULL) AS games,
        COUNT(g.id) FILTER (WHERE
          (g.white_user_id = $1 AND g.result = '1-0') OR
          (g.black_user_id = $1 AND g.result = '0-1')
        ) AS wins,
        COUNT(g.id) FILTER (WHERE
          (g.white_user_id = $1 AND g.result = '0-1') OR
          (g.black_user_id = $1 AND g.result = '1-0')
        ) AS losses,
        COUNT(g.id) FILTER (WHERE g.result = '1/2-1/2') AS draws
      FROM games g
      WHERE (g.white_user_id = $1 OR g.black_user_id = $1)
        AND g.status = 'completed' AND (g.is_bot_game IS NOT TRUE)
    `, [user.id]);

    const stats = statsResult.rows[0];

    // Recent 20 games
    const recentResult = await pool.query(`
      SELECT
        g.id, g.result, g.result_reason, g.time_control, g.ended_at,
        g.white_user_id, g.black_user_id, g.white_name, g.black_name,
        g.is_bot_game, g.bot_personality
      FROM games g
      WHERE (g.white_user_id = $1 OR g.black_user_id = $1)
        AND g.status = 'completed'
      ORDER BY g.ended_at DESC NULLS LAST
      LIMIT 20
    `, [user.id]);

    const recentGames = recentResult.rows.map((g) => {
      const playedWhite = g.white_user_id === user.id;
      const opponentName = playedWhite ? g.black_name : g.white_name;
      let playerResult;
      if (g.result === '1/2-1/2') {
        playerResult = 'draw';
      } else if (
        (playedWhite && g.result === '1-0') ||
        (!playedWhite && g.result === '0-1')
      ) {
        playerResult = 'win';
      } else {
        playerResult = 'loss';
      }
      return {
        id: g.id,
        opponent: opponentName,
        result: playerResult,
        reason: g.result_reason,
        timeControl: g.time_control,
        endedAt: g.ended_at,
        isBotGame: g.is_bot_game || false,
        botPersonality: g.bot_personality || null,
      };
    });

    res.json({
      player: {
        username: user.username,
        rating: user.rating,
        avatarId: user.avatar_id,
        createdAt: user.created_at,
        games: Number(stats.games),
        wins: Number(stats.wins),
        losses: Number(stats.losses),
        draws: Number(stats.draws),
        winRate: Number(stats.games) > 0
          ? Math.round((Number(stats.wins) / Number(stats.games)) * 100)
          : 0,
      },
      recentGames,
    });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// GET /api/leaderboard/players/:username/vs/:opponent — Head-to-head record
router.get('/players/:username/vs/:opponent', async (req, res) => {
  try {
    const { username, opponent } = req.params;

    const usersResult = await pool.query(
      'SELECT id, username FROM users WHERE username = $1 OR username = $2',
      [username, opponent]
    );
    const userMap = {};
    for (const row of usersResult.rows) {
      userMap[row.username] = row.id;
    }
    const userId = userMap[username];
    const opponentId = userMap[opponent];
    if (!userId || !opponentId) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const result = await pool.query(`
      SELECT
        COUNT(*) AS games,
        COUNT(*) FILTER (WHERE
          (g.white_user_id = $1 AND g.result = '1-0') OR
          (g.black_user_id = $1 AND g.result = '0-1')
        ) AS wins,
        COUNT(*) FILTER (WHERE
          (g.white_user_id = $2 AND g.result = '1-0') OR
          (g.black_user_id = $2 AND g.result = '0-1')
        ) AS opponent_wins,
        COUNT(*) FILTER (WHERE g.result = '1/2-1/2') AS draws
      FROM games g
      WHERE g.status = 'completed'
        AND (
          (g.white_user_id = $1 AND g.black_user_id = $2) OR
          (g.white_user_id = $2 AND g.black_user_id = $1)
        )
    `, [userId, opponentId]);

    const r = result.rows[0];
    res.json({
      player: username,
      opponent,
      games: Number(r.games),
      wins: Number(r.wins),
      opponentWins: Number(r.opponent_wins),
      draws: Number(r.draws),
    });
  } catch (err) {
    console.error('Head-to-head error:', err);
    res.status(500).json({ error: 'Failed to fetch head-to-head' });
  }
});

export default router;
