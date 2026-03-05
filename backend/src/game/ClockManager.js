export class ClockManager {
  constructor(timeControl, onTimeout) {
    // Support both number (seconds) and object { time, increment }
    const timeSeconds = typeof timeControl === 'object' ? timeControl.time : timeControl;
    const incrementSec = typeof timeControl === 'object' ? (timeControl.increment || 0) : 0;

    this.whiteTimeMs = timeSeconds * 1000;
    this.blackTimeMs = timeSeconds * 1000;
    this.incrementMs = incrementSec * 1000;
    this.activeSide = null; // 'w' | 'b' | null
    this.lastSwitchTimestamp = null;
    this.timeoutHandle = null;
    this.onTimeout = onTimeout;
  }

  start(side) {
    this.activeSide = side;
    this.lastSwitchTimestamp = Date.now();
    this._setTimeoutTimer();
  }

  switchTurn() {
    if (!this.activeSide) return;

    const elapsed = Date.now() - this.lastSwitchTimestamp;

    // Deduct elapsed, then add increment for the player who just moved
    if (this.activeSide === 'w') {
      this.whiteTimeMs = Math.max(0, this.whiteTimeMs - elapsed) + this.incrementMs;
    } else {
      this.blackTimeMs = Math.max(0, this.blackTimeMs - elapsed) + this.incrementMs;
    }

    clearTimeout(this.timeoutHandle);

    this.activeSide = this.activeSide === 'w' ? 'b' : 'w';
    this.lastSwitchTimestamp = Date.now();
    this._setTimeoutTimer();
  }

  pause() {
    if (!this.activeSide) return;

    const elapsed = Date.now() - this.lastSwitchTimestamp;
    if (this.activeSide === 'w') {
      this.whiteTimeMs = Math.max(0, this.whiteTimeMs - elapsed);
    } else {
      this.blackTimeMs = Math.max(0, this.blackTimeMs - elapsed);
    }

    clearTimeout(this.timeoutHandle);
    this.activeSide = null;
    this.lastSwitchTimestamp = null;
  }

  getTimesMs() {
    let white = this.whiteTimeMs;
    let black = this.blackTimeMs;

    if (this.activeSide && this.lastSwitchTimestamp) {
      const elapsed = Date.now() - this.lastSwitchTimestamp;
      if (this.activeSide === 'w') {
        white = Math.max(0, white - elapsed);
      } else {
        black = Math.max(0, black - elapsed);
      }
    }

    return { whiteTime: white, blackTime: black };
  }

  destroy() {
    clearTimeout(this.timeoutHandle);
    this.activeSide = null;
  }

  _setTimeoutTimer() {
    const remaining =
      this.activeSide === 'w' ? this.whiteTimeMs : this.blackTimeMs;

    this.timeoutHandle = setTimeout(() => {
      if (this.activeSide === 'w') {
        this.whiteTimeMs = 0;
      } else {
        this.blackTimeMs = 0;
      }
      const flaggedSide = this.activeSide;
      this.activeSide = null;
      this.onTimeout?.(flaggedSide);
    }, remaining);
  }
}
