/**
 * Wager gate validation — checks if a user meets creator-defined join requirements.
 */
export async function checkWagerGates(pool, userId, gates) {
  if (!gates || (!gates.requireVerified && !gates.minExternalRating)) {
    return { pass: true };
  }

  if (!userId) {
    return { pass: false, reason: 'You must be logged in to join gated wager games' };
  }

  const { rows: accounts } = await pool.query(
    'SELECT platform, is_verified, ratings FROM linked_accounts WHERE user_id = $1',
    [userId]
  );

  if (gates.requireVerified) {
    const verified = accounts.filter((a) => a.is_verified);
    if (verified.length === 0) {
      return { pass: false, reason: 'A verified Chess.com or Lichess account is required' };
    }
    // Require at least 100 total games across all verified accounts
    let totalGames = 0;
    for (const acct of verified) {
      if (acct.ratings && typeof acct.ratings === 'object') {
        for (const tc of Object.values(acct.ratings)) {
          totalGames += tc?.games || 0;
        }
      }
    }
    if (totalGames < 100) {
      return { pass: false, reason: 'Verified account must have at least 100 games played' };
    }
  }

  if (gates.minExternalRating) {
    const platform = gates.minExternalPlatform;
    const timeControl = gates.minExternalTimeControl;
    const minRating = gates.minExternalRating;

    const acct = accounts.find((a) => a.platform === platform && a.is_verified);
    if (!acct) {
      return { pass: false, reason: `A verified ${platform} account is required` };
    }

    const rating = acct.ratings?.[timeControl]?.rating;
    if (!rating || rating < minRating) {
      return {
        pass: false,
        reason: `Minimum ${minRating} ${platform} ${timeControl} rating required (yours: ${rating || 'N/A'})`,
      };
    }
  }

  return { pass: true };
}
