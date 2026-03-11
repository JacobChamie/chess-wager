export class PremiumExpiryChecker {
  constructor(pool) {
    this.pool = pool;
    this.interval = null;
  }

  start() {
    // Check every 5 minutes
    this.interval = setInterval(() => this.checkExpired(), 5 * 60 * 1000);
    // Also check immediately on start
    this.checkExpired();
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async checkExpired() {
    try {
      // Flip expired premium users
      const userRes = await this.pool.query(
        `UPDATE users SET is_premium = false
         WHERE is_premium = true AND premium_expires_at < NOW()
         RETURNING id`
      );

      // Mark corresponding subscriptions as expired
      if (userRes.rowCount > 0) {
        await this.pool.query(
          `UPDATE subscriptions SET status = 'expired'
           WHERE status = 'active' AND expires_at < NOW()`
        );
        console.log(`Premium expiry: ${userRes.rowCount} user(s) expired`);
      }
    } catch (err) {
      console.error('Premium expiry check error:', err.message);
    }
  }
}
